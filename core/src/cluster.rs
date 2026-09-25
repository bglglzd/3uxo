//! Кластеризация голосов: «сколько людей говорит и кто где».
//!
//! Движок диаризации (см. [`crate::diarize`]) режет речь на короткие окна
//! (~2 с) и для каждого считает эмбеддинг голоса (wespeaker). Здесь — чистая,
//! без ML-зависимостей часть: по этим эмбеддингам определить число говорящих
//! и разметить окна. Модуль собирается и тестируется на любой ОС.
//!
//! Алгоритм (по мотивам pyannote 3.x):
//! 1. Агломеративная кластеризация (AHC) с центроидной связью по косинусному
//!    расстоянию; центроид — взвешенная длительностью сумма нормированных
//!    эмбеддингов. Слияния идут, пока ближайшая пара ближе порога.
//! 2. «Мелкие» кластеры (мало речи — шум, смех, перекрёстная речь, эхо) не
//!    считаются отдельными людьми: их окна переназначаются ближайшему крупному.
//! 3. Если число голосов задано явно — крупные кластеры сливаются/добираются
//!    ровно до него.
//! 4. Пара итераций уточнения (как k-means): центроиды пересчитываются по
//!    разметке, окна переназначаются ближайшему центроиду.
//! 5. Окна без эмбеддинга (слишком короткие) получают метку соседа по времени.
//!
//! Так число голосов в авто-режиме перестаёт «плодиться» из-за шумных окон
//! (главная беда прежнего онлайн-алгоритма с жадным порогом).

use serde::{Deserialize, Serialize};

use crate::transcript::DiarSegment;

/// Фрагмент речи одного голоса с эмбеддингом. Обычно это «локальный
/// говорящий» одного 10-секундного окна сегментации: его отрезки речи
/// (`spans`) и эмбеддинг голоса по ним. Пустой `embedding` — посчитать не
/// удалось (слишком мало звука); такой фрагмент размечается по соседям.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EmbWindow {
    /// Начало первого отрезка речи, сек.
    pub start_secs: f64,
    /// Конец последнего отрезка речи, сек.
    pub end_secs: f64,
    #[serde(default)]
    pub embedding: Vec<f32>,
    /// Отрезки речи `[начало, конец]`; пусто — весь `[start_secs, end_secs]`.
    #[serde(default)]
    pub spans: Vec<(f64, f64)>,
}

impl EmbWindow {
    /// Отрезки речи фрагмента.
    pub fn spans(&self) -> Vec<(f64, f64)> {
        if self.spans.is_empty() {
            vec![(self.start_secs, self.end_secs)]
        } else {
            self.spans.clone()
        }
    }

    /// Сколько секунд речи во фрагменте.
    pub fn speech_secs(&self) -> f64 {
        self.spans().iter().map(|(a, b)| (b - a).max(0.0)).sum()
    }
}

/// Порог косинусного расстояния для слияния кластеров в авто-режиме
/// (центроидная связь). Подобран на записях с известным числом говорящих
/// (pyannote sample — 2, sherpa 4-speakers — 4): число голосов верное при
/// 0.35…0.55, выше похожие голоса начинают сливаться. Середина диапазона;
/// лишние мелкие кластеры при низком пороге снимает отсев по объёму речи.
pub const AUTO_THRESHOLD: f32 = 0.45;

/// Потолок числа голосов в авто-режиме.
pub const MAX_AUTO_SPEAKERS: usize = 10;

/// Доля речи, начиная с которой кластер считается отдельным человеком.
const MIN_SHARE: f64 = 0.02;
/// Нижняя граница «достаточной речи» для отдельного голоса, сек.
const MIN_SECS_FLOOR: f64 = 3.0;
/// Верхняя граница «достаточной речи» (для длинных встреч), сек: человек,
/// сказавший за двухчасовую встречу полминуты, всё равно отдельный голос.
const MIN_SECS_CAP: f64 = 25.0;
/// Итераций уточнения после кластеризации.
const REFINE_ITERS: usize = 2;

#[derive(Debug, Clone)]
struct Cluster {
    /// Взвешенная сумма нормированных эмбеддингов (направление = центроид).
    sum: Vec<f32>,
    /// Суммарная длительность речи, сек.
    weight: f64,
    /// Индексы окон (в массиве валидных окон).
    members: Vec<usize>,
}

fn norm(v: &[f32]) -> f32 {
    v.iter().map(|x| x * x).sum::<f32>().sqrt()
}

fn cos_dist(a: &[f32], b: &[f32]) -> f32 {
    let na = norm(a);
    let nb = norm(b);
    if na == 0.0 || nb == 0.0 {
        return 1.0;
    }
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    1.0 - dot / (na * nb)
}

/// Нормированный эмбеддинг или `None`, если он пустой/вырожденный/с NaN.
fn normalized(e: &[f32]) -> Option<Vec<f32>> {
    if e.is_empty() || e.iter().any(|x| !x.is_finite()) {
        return None;
    }
    let n = norm(e);
    if n <= f32::EPSILON {
        return None;
    }
    Some(e.iter().map(|x| x / n).collect())
}

/// Агломеративная кластеризация (центроидная связь, косинус). Сливает, пока
/// `stop(число_кластеров, расстояние_ближайшей_пары)` не скажет «хватит».
/// Ближайшие соседи кешируются по строкам — O(n²) в типичном случае.
fn ahc(mut clusters: Vec<Cluster>, stop: impl Fn(usize, f32) -> bool) -> Vec<Cluster> {
    let n = clusters.len();
    if n <= 1 {
        return clusters;
    }
    let mut alive = vec![true; n];
    let mut dist = vec![0f32; n * n];
    for i in 0..n {
        for j in (i + 1)..n {
            let d = cos_dist(&clusters[i].sum, &clusters[j].sum);
            dist[i * n + j] = d;
            dist[j * n + i] = d;
        }
    }
    let nearest = |i: usize, alive: &[bool], dist: &[f32]| -> (usize, f32) {
        let mut best = (usize::MAX, f32::INFINITY);
        for k in 0..n {
            if k != i && alive[k] && dist[i * n + k] < best.1 {
                best = (k, dist[i * n + k]);
            }
        }
        best
    };
    let mut nn: Vec<(usize, f32)> = (0..n).map(|i| nearest(i, &alive, &dist)).collect();
    let mut count = n;

    while count > 1 {
        // Глобально ближайшая пара.
        let (i, (j, d)) = match (0..n)
            .filter(|&i| alive[i] && nn[i].0 != usize::MAX)
            .map(|i| (i, nn[i]))
            .min_by(|a, b| a.1 .1.partial_cmp(&b.1 .1).unwrap_or(std::cmp::Ordering::Equal))
        {
            Some(p) => p,
            None => break,
        };
        if stop(count, d) {
            break;
        }
        // j вливается в i.
        let cj = std::mem::replace(
            &mut clusters[j],
            Cluster { sum: Vec::new(), weight: 0.0, members: Vec::new() },
        );
        for (a, b) in clusters[i].sum.iter_mut().zip(&cj.sum) {
            *a += *b;
        }
        clusters[i].weight += cj.weight;
        clusters[i].members.extend(cj.members);
        alive[j] = false;
        count -= 1;

        for k in 0..n {
            if alive[k] && k != i {
                let dk = cos_dist(&clusters[i].sum, &clusters[k].sum);
                dist[i * n + k] = dk;
                dist[k * n + i] = dk;
            }
        }
        for k in 0..n {
            if !alive[k] || k == i {
                continue;
            }
            if nn[k].0 == i || nn[k].0 == j {
                nn[k] = nearest(k, &alive, &dist);
            } else if dist[k * n + i] < nn[k].1 {
                nn[k] = (i, dist[k * n + i]);
            }
        }
        nn[i] = nearest(i, &alive, &dist);
    }

    clusters
        .into_iter()
        .zip(alive)
        .filter_map(|(c, a)| a.then_some(c))
        .collect()
}

/// Индекс ближайшего центроида (по косинусу) для нормированного вектора.
fn nearest_centroid(v: &[f32], centroids: &[Vec<f32>]) -> usize {
    let mut best = (0usize, f32::INFINITY);
    for (c, cen) in centroids.iter().enumerate() {
        let d = cos_dist(v, cen);
        if d < best.1 {
            best = (c, d);
        }
    }
    best.0
}

/// Минимум речи (сек), чтобы кластер считался отдельным человеком.
fn min_speaker_secs(total: f64) -> f64 {
    (total * MIN_SHARE).clamp(MIN_SECS_FLOOR, MIN_SECS_CAP)
}

/// Размечает окна номерами говорящих `0..k` (по порядку первого появления).
/// `num_speakers`: `Some(n)` — ровно n голосов (если хватает материала),
/// `None` — определить автоматически.
pub fn cluster_windows(windows: &[EmbWindow], num_speakers: Option<usize>) -> Vec<u32> {
    cluster_windows_with(windows, num_speakers, AUTO_THRESHOLD)
}

/// То же, что [`cluster_windows`], с явным порогом (для подбора/тестов).
pub fn cluster_windows_with(
    windows: &[EmbWindow],
    num_speakers: Option<usize>,
    threshold: f32,
) -> Vec<u32> {
    if windows.is_empty() {
        return Vec::new();
    }
    // Валидные окна: нормированный эмбеддинг + вес (длительность).
    let mut valid: Vec<usize> = Vec::new();
    let mut vecs: Vec<Vec<f32>> = Vec::new();
    let mut weights: Vec<f64> = Vec::new();
    for (i, w) in windows.iter().enumerate() {
        if let Some(v) = normalized(&w.embedding) {
            valid.push(i);
            vecs.push(v);
            weights.push(w.speech_secs().max(0.05));
        }
    }
    if valid.is_empty() {
        return vec![0; windows.len()];
    }

    let total: f64 = weights.iter().sum();
    let initial: Vec<Cluster> = vecs
        .iter()
        .zip(&weights)
        .enumerate()
        .map(|(m, (v, &w))| Cluster {
            sum: v.iter().map(|x| x * w as f32).collect(),
            weight: w,
            members: vec![m],
        })
        .collect();

    // 1. AHC до порога. Если задано больше голосов, чем кластеров до порога,
    // — дробим мельче: AHC ровно до нужного числа.
    let mut clusters = ahc(initial.clone(), |_, d| d > threshold);
    if let Some(k) = num_speakers {
        if clusters.len() < k && initial.len() >= k {
            clusters = ahc(initial, move |count, _| count <= k);
        }
    }
    clusters.sort_by(|a, b| b.weight.partial_cmp(&a.weight).unwrap_or(std::cmp::Ordering::Equal));

    // 2. Крупные кластеры — люди, мелкие — шум.
    let min_secs = min_speaker_secs(total);
    let mut n_large = clusters.iter().filter(|c| c.weight >= min_secs).count().max(1);

    // 3. Нужное число голосов.
    let target = match num_speakers {
        Some(k) => k.max(1).min(clusters.len().max(1)),
        None => n_large.min(MAX_AUTO_SPEAKERS),
    };
    if n_large < target {
        // Задано больше голосов, чем нашлось крупных — добираем самыми весомыми.
        n_large = target;
    }
    let mut large: Vec<Cluster> = clusters.into_iter().take(n_large).collect();
    if large.len() > target {
        large = ahc(large, move |count, _| count <= target);
    }

    // 4. Переназначение всех окон ближайшему центроиду + уточнение.
    let mut centroids: Vec<Vec<f32>> = large
        .iter()
        .map(|c| normalized(&c.sum).unwrap_or_else(|| vec![0.0; c.sum.len()]))
        .collect();
    let mut assign: Vec<usize> = vecs.iter().map(|v| nearest_centroid(v, &centroids)).collect();
    for _ in 0..REFINE_ITERS {
        let dim = vecs[0].len();
        let mut sums = vec![vec![0f32; dim]; centroids.len()];
        for (m, &c) in assign.iter().enumerate() {
            for (s, x) in sums[c].iter_mut().zip(&vecs[m]) {
                *s += x * weights[m] as f32;
            }
        }
        // Опустевший кластер сохраняет прежний центроид.
        for (c, s) in sums.into_iter().enumerate() {
            if let Some(v) = normalized(&s) {
                centroids[c] = v;
            }
        }
        assign = vecs.iter().map(|v| nearest_centroid(v, &centroids)).collect();
    }

    // 5. Разметка всех окон: валидные — по кластеру, прочие — по соседу.
    let mut raw: Vec<Option<usize>> = vec![None; windows.len()];
    for (m, &wi) in valid.iter().enumerate() {
        raw[wi] = Some(assign[m]);
    }
    let labels = fill_by_time(windows, &raw);
    renumber(windows, &labels)
}

/// Метка для окон без эмбеддинга — от ближайшего по времени размеченного окна.
fn fill_by_time(windows: &[EmbWindow], raw: &[Option<usize>]) -> Vec<usize> {
    let labeled: Vec<usize> = (0..windows.len()).filter(|&i| raw[i].is_some()).collect();
    (0..windows.len())
        .map(|i| match raw[i] {
            Some(l) => l,
            None => {
                let mid = (windows[i].start_secs + windows[i].end_secs) / 2.0;
                labeled
                    .iter()
                    .min_by(|&&a, &&b| {
                        let da = gap(mid, &windows[a]);
                        let db = gap(mid, &windows[b]);
                        da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
                    })
                    .and_then(|&j| raw[j])
                    .unwrap_or(0)
            }
        })
        .collect()
}

fn gap(t: f64, w: &EmbWindow) -> f64 {
    if t < w.start_secs {
        w.start_secs - t
    } else if t > w.end_secs {
        t - w.end_secs
    } else {
        0.0
    }
}

/// Перенумерация меток по порядку первого появления во времени: 0, 1, 2…
fn renumber(windows: &[EmbWindow], labels: &[usize]) -> Vec<u32> {
    let mut order: Vec<usize> = (0..windows.len()).collect();
    order.sort_by(|&a, &b| {
        windows[a]
            .start_secs
            .partial_cmp(&windows[b].start_secs)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut map: std::collections::HashMap<usize, u32> = Default::default();
    for &i in &order {
        let next = map.len() as u32;
        map.entry(labels[i]).or_insert(next);
    }
    labels.iter().map(|l| map[l]).collect()
}

/// Фрагменты + метки → сегменты диаризации (по отрезкам речи); соседние
/// отрезки одного говорящего, идущие почти встык, склеиваются.
pub fn windows_to_diar(windows: &[EmbWindow], labels: &[u32]) -> Vec<DiarSegment> {
    let mut all: Vec<DiarSegment> = Vec::new();
    for (w, &l) in windows.iter().zip(labels) {
        for (a, b) in w.spans() {
            all.push(DiarSegment { start_secs: a, end_secs: b, speaker: l });
        }
    }
    all.sort_by(|a, b| {
        a.start_secs
            .partial_cmp(&b.start_secs)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut out: Vec<DiarSegment> = Vec::new();
    for d in all {
        if let Some(last) = out.iter_mut().rev().take(3).find(|x| x.speaker == d.speaker) {
            if d.start_secs - last.end_secs < 0.3 && d.start_secs >= last.start_secs {
                last.end_secs = last.end_secs.max(d.end_secs);
                continue;
            }
        }
        out.push(d);
    }
    out
}

/// Окна с эмбеддингами → сегменты диаризации (кластеризация + склейка).
pub fn diarize_windows(windows: &[EmbWindow], num_speakers: Option<usize>) -> Vec<DiarSegment> {
    let labels = cluster_windows(windows, num_speakers);
    windows_to_diar(windows, &labels)
}

/// Сколько разных говорящих в разметке.
pub fn count_speakers(labels: &[u32]) -> usize {
    let mut v: Vec<u32> = labels.to_vec();
    v.sort_unstable();
    v.dedup();
    v.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Детерминированный «голос»: базовый вектор + небольшой шум.
    fn voice(base: usize, dim: usize, noise_seed: u32, noise: f32) -> Vec<f32> {
        let mut v = vec![0f32; dim];
        // Каждый голос — своя группа координат.
        for k in 0..4 {
            v[(base * 4 + k) % dim] = 1.0;
        }
        let mut s = noise_seed.wrapping_mul(2654435761).wrapping_add(base as u32 * 97);
        for x in v.iter_mut() {
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            *x += ((s % 1000) as f32 / 1000.0 - 0.5) * noise;
        }
        v
    }

    fn windows_for(script: &[(usize, f64)], noise: f32) -> Vec<EmbWindow> {
        let mut t = 0.0;
        let mut out = Vec::new();
        for (i, &(spk, dur)) in script.iter().enumerate() {
            out.push(EmbWindow {
                start_secs: t,
                end_secs: t + dur,
                embedding: voice(spk, 32, i as u32 + 1, noise),
                spans: vec![],
            });
            t += dur + 0.1;
        }
        out
    }

    #[test]
    fn auto_finds_two_speakers() {
        let script: Vec<(usize, f64)> =
            (0..40).map(|i| (if (i / 3) % 2 == 0 { 0 } else { 1 }, 2.0)).collect();
        let w = windows_for(&script, 0.3);
        let labels = cluster_windows(&w, None);
        assert_eq!(count_speakers(&labels), 2);
        // Первое окно — говорящий 0, смена на 4-м окне.
        assert_eq!(labels[0], 0);
        assert_eq!(labels[3], 1);
        for (i, &(spk, _)) in script.iter().enumerate() {
            assert_eq!(labels[i] as usize, spk, "window {i}");
        }
    }

    #[test]
    fn auto_finds_four_speakers() {
        let script: Vec<(usize, f64)> = (0..60).map(|i| ((i / 2) % 4, 2.0)).collect();
        let w = windows_for(&script, 0.3);
        assert_eq!(count_speakers(&cluster_windows(&w, None)), 4);
    }

    #[test]
    fn tiny_noise_cluster_is_not_a_speaker() {
        // Два собеседника по минуте + одно шумное окно «третьего» голоса на 0.6 с.
        let mut script: Vec<(usize, f64)> =
            (0..60).map(|i| (if i % 4 < 2 { 0 } else { 1 }, 2.0)).collect();
        script.insert(30, (5, 0.6));
        let w = windows_for(&script, 0.3);
        assert_eq!(count_speakers(&cluster_windows(&w, None)), 2);
    }

    #[test]
    fn exact_count_is_respected() {
        let script: Vec<(usize, f64)> = (0..60).map(|i| ((i / 2) % 4, 2.0)).collect();
        let w = windows_for(&script, 0.3);
        assert_eq!(count_speakers(&cluster_windows(&w, Some(2))), 2);
        assert_eq!(count_speakers(&cluster_windows(&w, Some(4))), 4);
        assert_eq!(count_speakers(&cluster_windows(&w, Some(1))), 1);
    }

    #[test]
    fn single_speaker_stays_single() {
        let script: Vec<(usize, f64)> = (0..50).map(|_| (0, 2.0)).collect();
        let w = windows_for(&script, 0.5);
        assert_eq!(count_speakers(&cluster_windows(&w, None)), 1);
    }

    #[test]
    fn windows_without_embedding_take_neighbour_label() {
        let script: Vec<(usize, f64)> =
            (0..20).map(|i| (if i < 10 { 0 } else { 1 }, 2.0)).collect();
        let mut w = windows_for(&script, 0.2);
        w[15].embedding.clear();
        let labels = cluster_windows(&w, None);
        assert_eq!(labels[15], labels[14]);
    }

    #[test]
    fn empty_and_degenerate_inputs() {
        assert!(cluster_windows(&[], None).is_empty());
        let w = vec![EmbWindow { start_secs: 0.0, end_secs: 1.0, embedding: vec![], spans: vec![] }];
        assert_eq!(cluster_windows(&w, None), vec![0]);
        let w = vec![EmbWindow {
            start_secs: 0.0,
            end_secs: 1.0,
            embedding: vec![f32::NAN; 4],
            spans: vec![],
        }];
        assert_eq!(cluster_windows(&w, Some(3)), vec![0]);
    }

    #[test]
    fn windows_to_diar_merges_adjacent_same_speaker() {
        let w: Vec<EmbWindow> = (0..4)
            .map(|i| EmbWindow {
                start_secs: i as f64 * 2.0,
                end_secs: i as f64 * 2.0 + 2.0,
                embedding: vec![],
                spans: vec![],
            })
            .collect();
        let d = windows_to_diar(&w, &[0, 0, 1, 1]);
        assert_eq!(d.len(), 2);
        assert_eq!((d[0].start_secs, d[0].end_secs, d[0].speaker), (0.0, 4.0, 0));
        assert_eq!((d[1].start_secs, d[1].end_secs, d[1].speaker), (4.0, 8.0, 1));
    }

    #[test]
    fn windows_to_diar_uses_spans() {
        let w = vec![
            EmbWindow {
                start_secs: 0.0,
                end_secs: 5.0,
                embedding: vec![],
                spans: vec![(0.0, 1.0), (4.0, 5.0)],
            },
            EmbWindow {
                start_secs: 1.5,
                end_secs: 3.5,
                embedding: vec![],
                spans: vec![(1.5, 3.5)],
            },
        ];
        let d = windows_to_diar(&w, &[0, 1]);
        let got: Vec<(f64, u32)> = d.iter().map(|x| (x.start_secs, x.speaker)).collect();
        assert_eq!(got, vec![(0.0, 0), (1.5, 1), (4.0, 0)]);
    }

    #[test]
    fn cache_round_trips_json() {
        let w = EmbWindow {
            start_secs: 1.0,
            end_secs: 2.5,
            embedding: vec![0.25, -0.5],
            spans: vec![(1.0, 1.5), (2.0, 2.5)],
        };
        assert!((w.speech_secs() - 1.0).abs() < 1e-9);
        let s = serde_json::to_string(&w).unwrap();
        assert_eq!(serde_json::from_str::<EmbWindow>(&s).unwrap(), w);
    }
}
