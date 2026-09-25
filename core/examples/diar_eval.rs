//! Отладочный стенд диаризации: считает окна/эмбеддинги по WAV (16 кГц моно)
//! и печатает число найденных голосов при разных порогах, а при наличии RTTM —
//! долю правильно размеченного времени речи.
//!
//! `cargo run --release -p uxo-core --features diarize --example diar_eval -- \
//!     <data_dir с models/diarize> <file.wav> [file.rttm]`

use std::path::Path;

use uxo_core::cluster::{cluster_windows_with, count_speakers, EmbWindow};
use uxo_core::diarize::OnnxDiarizer;

fn load_rttm(path: &str) -> Vec<(f64, f64, String)> {
    std::fs::read_to_string(path)
        .unwrap()
        .lines()
        .filter_map(|l| {
            let p: Vec<&str> = l.split_whitespace().collect();
            if p.len() < 8 {
                return None;
            }
            let s: f64 = p[3].parse().ok()?;
            let d: f64 = p[4].parse().ok()?;
            Some((s, s + d, p[7].to_string()))
        })
        .collect()
}

/// Доля времени (по кадрам 10 мс, только где говорит ровно один по RTTM),
/// размеченного верно при лучшем жадном сопоставлении меток.
fn accuracy(windows: &[EmbWindow], labels: &[u32], rttm: &[(f64, f64, String)]) -> f64 {
    use std::collections::HashMap;
    let end = rttm.iter().map(|r| r.1).fold(0.0, f64::max);
    let mut conf: HashMap<(String, u32), usize> = HashMap::new();
    let mut frames = 0usize;
    let mut t = 0.0;
    while t < end {
        let refs: Vec<&String> = rttm.iter().filter(|r| r.0 <= t && t < r.1).map(|r| &r.2).collect();
        if refs.len() == 1 {
            if let Some(i) = windows
                .iter()
                .position(|w| w.spans().iter().any(|&(a, b)| a <= t && t < b))
            {
                *conf.entry((refs[0].clone(), labels[i])).or_default() += 1;
            }
            frames += 1;
        }
        t += 0.01;
    }
    let mut pairs: Vec<_> = conf.into_iter().collect();
    pairs.sort_by(|a, b| b.1.cmp(&a.1));
    let (mut used_r, mut used_h, mut ok) = (vec![], vec![], 0usize);
    for ((r, h), n) in pairs {
        if !used_r.contains(&r) && !used_h.contains(&h) {
            used_r.push(r);
            used_h.push(h);
            ok += n;
        }
    }
    ok as f64 / frames.max(1) as f64
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let data_dir = Path::new(&args[1]);
    let wav = Path::new(&args[2]);
    let rttm = args.get(3).map(|p| load_rttm(p));

    let d = OnnxDiarizer::managed(data_dir, None, &|_| {}).expect("models");
    let t0 = std::time::Instant::now();
    let windows = d.embed(wav, &|_, _| {}).expect("embed");
    let with_emb = windows.iter().filter(|w| !w.embedding.is_empty()).count();
    println!(
        "{}: {} окон ({} с эмбеддингом), {:.1} c",
        wav.display(),
        windows.len(),
        with_emb,
        t0.elapsed().as_secs_f32()
    );
    if let Some(r) = &rttm {
        let mut spk: Vec<&String> = r.iter().map(|x| &x.2).collect();
        spk.sort();
        spk.dedup();
        println!("  эталон: {} голосов", spk.len());
    }
    if std::env::var("DIAR_DEBUG").is_ok() {
        let labels = cluster_windows_with(&windows, None, 0.5);
        for (w, l) in windows.iter().zip(&labels) {
            println!(
                "    {:6.2}-{:6.2} речь {:4.1}с emb={} → {}",
                w.start_secs,
                w.end_secs,
                w.speech_secs(),
                !w.embedding.is_empty(),
                l
            );
        }
    }
    for th in [0.35f32, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75] {
        let labels = cluster_windows_with(&windows, None, th);
        let acc = rttm.as_ref().map(|r| accuracy(&windows, &labels, r));
        println!(
            "  порог {th:.2}: голосов {}{}",
            count_speakers(&labels),
            acc.map(|a| format!(", точность {:.1}%", a * 100.0)).unwrap_or_default()
        );
    }
}
