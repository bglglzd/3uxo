//! Диаризация — «кто когда говорил». Трейт и мок доступны всегда; реальный
//! движок (pyannote segmentation-3.0 + wespeaker на ONNX Runtime) прячется за
//! cargo-фичей `diarize` (тяжёлые ML-зависимости; модели качаются один раз).
//!
//! Результат — `Vec<DiarSegment>`, который склеивается с текстом whisper через
//! [`crate::transcript::assign_speakers`].

use std::path::Path;

use crate::error::AppResult;
use crate::transcript::DiarSegment;

/// Источник разметки говорящих по одному моно-WAV (16 кГц).
/// Только `Send` (без `Sync`): burn-модели держат `OnceCell` и `Sync` не дают,
/// а диаризатор создаётся локально в команде и в общем состоянии не хранится.
pub trait Diarizer: Send {
    fn diarize(&self, wav_16k_mono: &Path) -> AppResult<Vec<DiarSegment>>;
}

/// Мок: ничего не размечает (пустой результat ⇒ один говорящий `spk0` после
/// [`crate::transcript::assign_speakers`]). Для тестов и сборок без фичи.
pub struct MockDiarizer;

impl Diarizer for MockDiarizer {
    fn diarize(&self, _wav_16k_mono: &Path) -> AppResult<Vec<DiarSegment>> {
        Ok(Vec::new())
    }
}

/// Каталог моделей диаризации: `<data_dir>/models/diarize`.
fn models_dir(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join("models").join("diarize")
}

/// Пути к моделям диаризации (ONNX): сегментация и эмбеддинги голоса.
pub fn model_paths(data_dir: &Path) -> (std::path::PathBuf, std::path::PathBuf) {
    let dir = models_dir(data_dir);
    (dir.join("segmentation-3.0.onnx"), dir.join("wespeaker-resnet34.onnx"))
}

/// Минимальные размеры моделей (защита от оборванной закачки).
const SEG_MIN_BYTES: u64 = 5_000_000; // реально ~5.9 МБ
const EMB_MIN_BYTES: u64 = 25_000_000; // реально ~26.5 МБ

/// Файл есть и не меньше `min_bytes` (не оборванная закачка).
fn file_ok(path: &Path, min_bytes: u64) -> bool {
    std::fs::metadata(path).map(|m| m.len() > min_bytes).unwrap_or(false)
}

/// Скачаны ли модели диаризации (для экрана «Модели» в настройках).
pub fn models_present(data_dir: &Path) -> bool {
    let (seg, emb) = model_paths(data_dir);
    file_ok(&seg, SEG_MIN_BYTES) && file_ok(&emb, EMB_MIN_BYTES)
}

/// Удаляет модели прежнего движка (Burn, `.bpk`) — они больше не нужны.
pub fn remove_legacy_models(data_dir: &Path) {
    let dir = models_dir(data_dir);
    for f in ["segmentation.bpk", "embedding.bpk"] {
        let _ = std::fs::remove_file(dir.join(f));
    }
}

/// Размер скачанных моделей диаризации на диске, байт.
pub fn models_size(data_dir: &Path) -> u64 {
    let (seg, emb) = model_paths(data_dir);
    [seg, emb]
        .iter()
        .filter_map(|p| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .sum()
}

// ── Реальный движок (ONNX Runtime) за фичей `diarize` ───────────────────────
#[cfg(feature = "diarize")]
mod engine {
    use std::path::Path;
    use std::sync::Mutex;

    use kaldi_native_fbank::online::FeatureComputer;
    use kaldi_native_fbank::{FbankComputer, FbankOptions, OnlineFeature};
    use ort::session::Session;
    use ort::value::Tensor;

    use crate::cluster::EmbWindow;
    use crate::error::{AppError, AppResult};
    use crate::transcript::DiarSegment;

    use super::{file_ok, model_paths, Diarizer, EMB_MIN_BYTES, SEG_MIN_BYTES};

    /// pyannote/segmentation-3.0 (ONNX). Файлы — GitHub-релизы (не HuggingFace:
    /// он недоступен у части пользователей и требует принять условия).
    const SEG_URL: &str =
        "https://github.com/thewh1teagle/pyannote-rs/releases/download/v0.1.0/segmentation-3.0.onnx";
    /// wespeaker ResNet34-LM (VoxCeleb) — та же модель эмбеддингов, что в pyannote 3.1.
    const EMB_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx";
    /// Доля прогресса на сегментационную модель (она меньше эмбеддинговой).
    const SEG_WEIGHT: f32 = 0.18;

    const SR: usize = 16_000;
    /// Окно сегментации — 10 с (на этом обучена segmentation-3.0).
    const WIN: usize = 10 * SR;
    /// Шаг окна: 50% перекрытия — стыки окон не рвут реплики.
    const STEP: usize = 5 * SR;
    /// Сколько секунд чистой (без наложения) речи нужно для эмбеддинга.
    const MIN_EMBED_SECS: f64 = 0.6;
    /// Короче — не считаем отрезком речи (щелчок/шум), сек.
    const MIN_RUN_SECS: f64 = 0.12;
    /// Потолок звука на один эмбеддинг (центральная часть), сек.
    const MAX_EMBED_SECS: f64 = 10.0;

    /// Гарантирует наличие обеих моделей. Прогресс (0.0..=1.0) зовётся ТОЛЬКО
    /// при реальном скачивании — иначе интерфейс при каждой расшифровке писал
    /// «Скачивание модели».
    pub fn ensure_models(data_dir: &Path, on_progress: &dyn Fn(f32)) -> AppResult<()> {
        let (seg, emb) = model_paths(data_dir);
        if let Some(dir) = seg.parent() {
            std::fs::create_dir_all(dir)?;
        }
        super::remove_legacy_models(data_dir);
        let mut downloaded = false;
        if !file_ok(&seg, SEG_MIN_BYTES) {
            crate::models::download_to(SEG_URL, &seg, &|f| on_progress(f * SEG_WEIGHT))?;
            downloaded = true;
        }
        if !file_ok(&emb, EMB_MIN_BYTES) {
            crate::models::download_to(EMB_URL, &emb, &|f| on_progress(SEG_WEIGHT + f * (1.0 - SEG_WEIGHT)))?;
            downloaded = true;
        }
        if downloaded {
            on_progress(1.0);
        }
        Ok(())
    }

    fn ort_err(e: impl std::fmt::Display) -> AppError {
        AppError::Audio(format!("diarize: {e}"))
    }

    fn load(path: &Path) -> AppResult<Session> {
        let threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .clamp(1, 8);
        Session::builder()
            .map_err(ort_err)?
            .with_intra_threads(threads)
            .map_err(ort_err)?
            .commit_from_file(path)
            .map_err(ort_err)
    }

    /// Диаризатор: pyannote segmentation-3.0 (кто из ≤3 локальных голосов
    /// говорит в каждом кадре 10-секундного окна) + wespeaker (эмбеддинг голоса
    /// каждого локального говорящего в окне). Число и разметку говорящих по
    /// всей записи определяет [`crate::cluster`].
    pub struct OnnxDiarizer {
        seg: Mutex<Session>,
        emb: Mutex<Session>,
        num_speakers: Option<usize>,
    }

    /// Прогресс анализа голосов: (готово окон, всего окон).
    pub type EmbedProgress<'a> = &'a dyn Fn(usize, usize);

    impl OnnxDiarizer {
        /// Гарантирует модели (скачивает с прогрессом только при первом
        /// запуске) и грузит их. `num_speakers`: `Some(n)` — ровно n голосов,
        /// `None` — определить автоматически.
        pub fn managed(
            data_dir: &Path,
            num_speakers: Option<usize>,
            on_download: &dyn Fn(f32),
        ) -> AppResult<Self> {
            ensure_models(data_dir, on_download)?;
            let (seg, emb) = model_paths(data_dir);
            Ok(Self {
                seg: Mutex::new(load(&seg)?),
                emb: Mutex::new(load(&emb)?),
                num_speakers: num_speakers.filter(|&n| n > 0),
            })
        }

        /// Маски активности 3 локальных говорящих по кадрам окна (бит k — говорит k).
        fn segment(&self, window: &[f32]) -> AppResult<Vec<u8>> {
            let input = Tensor::from_array(([1usize, 1, window.len()], window.to_vec()))
                .map_err(ort_err)?;
            let mut seg = self.seg.lock().unwrap();
            let outputs = seg.run(ort::inputs![input]).map_err(ort_err)?;
            let (shape, data) = outputs[0].try_extract_tensor::<f32>().map_err(ort_err)?;
            let frames = shape.get(1).copied().unwrap_or(0).max(0) as usize;
            let classes = shape.get(2).copied().unwrap_or(0).max(0) as usize;
            if classes != 7 {
                return Err(ort_err(format!("unexpected segmentation classes: {classes}")));
            }
            // Powerset: 0 — тишина, 1..3 — один говорящий, 4..6 — пары.
            const MASK: [u8; 7] = [0, 0b001, 0b010, 0b100, 0b011, 0b101, 0b110];
            Ok((0..frames)
                .map(|f| {
                    let row = &data[f * classes..(f + 1) * classes];
                    let best = row
                        .iter()
                        .enumerate()
                        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
                        .map(|(i, _)| i)
                        .unwrap_or(0);
                    MASK[best]
                })
                .collect())
        }

        /// Эмбеддинг голоса по звуку (f32, [-1, 1]); `None`, если не вышло.
        fn embedding(&self, samples: &[f32]) -> Option<Vec<f32>> {
            let feats = fbank(samples)?;
            let frames = feats.len() / 80;
            let input = Tensor::from_array(([1usize, frames, 80], feats)).ok()?;
            let mut emb = self.emb.lock().unwrap();
            let outputs = emb.run(ort::inputs![input]).ok()?;
            let (_, data) = outputs[0].try_extract_tensor::<f32>().ok()?;
            let v = data.to_vec();
            (!v.is_empty() && v.iter().all(|x| x.is_finite())).then_some(v)
        }

        /// Анализ голосов записи: для каждого 10-секундного окна и каждого
        /// локального говорящего — отрезки его речи и эмбеддинг голоса. Итог
        /// кешируется на диск: разметку под другое число голосов можно пересчитать
        /// мгновенно, без повторного анализа.
        pub fn embed(&self, wav_16k_mono: &Path, progress: EmbedProgress) -> AppResult<Vec<EmbWindow>> {
            let audio = read_wav_f32(wav_16k_mono)?;
            if audio.is_empty() {
                return Ok(Vec::new());
            }
            let len = audio.len();
            let starts: Vec<usize> = if len <= WIN {
                vec![0]
            } else {
                let mut v: Vec<usize> = (0..=(len - WIN)).step_by(STEP).collect();
                if *v.last().unwrap() + WIN < len {
                    v.push(len - WIN);
                }
                v
            };
            // Каждый кадр аудио «принадлежит» окну, в центре которого он лежит
            // (края окон сегментация видит хуже).
            let own = |i: usize| -> (usize, usize) {
                let s = starts[i];
                let a = if i == 0 { 0 } else { (starts[i - 1] + WIN + s) / 2 };
                let b = if i + 1 == starts.len() { len } else { (s + WIN + starts[i + 1]) / 2 };
                (a.max(s), b.min(s + WIN).max(a.max(s)))
            };

            let mut out = Vec::new();
            let total = starts.len();
            for (wi, &s) in starts.iter().enumerate() {
                let mut window = vec![0f32; WIN];
                let e = (s + WIN).min(len);
                window[..e - s].copy_from_slice(&audio[s..e]);
                let masks = self.segment(&window)?;
                let nf = masks.len().max(1);
                let fs = WIN as f64 / nf as f64; // сэмплов на кадр
                let (own_a, own_b) = own(wi);

                for k in 0..3u8 {
                    let bit = 1u8 << k;
                    // Отрезки речи говорящего k в «своей» зоне окна.
                    let mut spans: Vec<(f64, f64)> = Vec::new();
                    let mut clean: Vec<(usize, usize)> = Vec::new();
                    let mut active: Vec<(usize, usize)> = Vec::new();
                    let mut run: Option<usize> = None;
                    for f in 0..=nf {
                        let on = f < nf && masks[f] & bit != 0;
                        match (on, run) {
                            (true, None) => run = Some(f),
                            (false, Some(r)) => {
                                let a = s + (r as f64 * fs) as usize;
                                let b = (s + (f as f64 * fs) as usize).min(len);
                                run = None;
                                let (a, b) = (a.max(own_a), b.min(own_b));
                                if b > a && (b - a) as f64 / SR as f64 >= MIN_RUN_SECS {
                                    spans.push((a as f64 / SR as f64, b as f64 / SR as f64));
                                }
                            }
                            _ => {}
                        }
                        if f < nf && masks[f] & bit != 0 {
                            let a = s + (f as f64 * fs) as usize;
                            let b = (s + ((f + 1) as f64 * fs) as usize).min(e);
                            if b > a {
                                active.push((a, b));
                                if masks[f] == bit {
                                    clean.push((a, b));
                                }
                            }
                        }
                    }
                    if spans.is_empty() {
                        continue;
                    }
                    // Эмбеддинг — по чистой речи (без наложения голосов), если её
                    // достаточно, иначе по всей речи говорящего в окне.
                    let secs = |v: &[(usize, usize)]| {
                        v.iter().map(|(a, b)| b - a).sum::<usize>() as f64 / SR as f64
                    };
                    let src = if secs(&clean) >= MIN_EMBED_SECS { &clean } else { &active };
                    let embedding = if secs(src) >= MIN_EMBED_SECS {
                        let mut buf: Vec<f32> = Vec::new();
                        for &(a, b) in src.iter() {
                            buf.extend_from_slice(&audio[a..b]);
                        }
                        let max = (MAX_EMBED_SECS * SR as f64) as usize;
                        if buf.len() > max {
                            let off = (buf.len() - max) / 2;
                            buf = buf[off..off + max].to_vec();
                        }
                        self.embedding(&buf).unwrap_or_default()
                    } else {
                        Vec::new()
                    };
                    out.push(EmbWindow {
                        start_secs: spans[0].0,
                        end_secs: spans[spans.len() - 1].1,
                        embedding,
                        spans,
                    });
                }
                progress(wi + 1, total);
            }
            out.sort_by(|a, b| {
                a.start_secs
                    .partial_cmp(&b.start_secs)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            Ok(out)
        }
    }

    /// 80-мерные Kaldi fbank-признаки (как в wespeaker) с вычитанием среднего.
    fn fbank(samples: &[f32]) -> Option<Vec<f32>> {
        let mut opts = FbankOptions::default();
        opts.mel_opts.num_bins = 80;
        opts.use_energy = false;
        opts.frame_opts.dither = 0.0;
        opts.frame_opts.samp_freq = SR as f32;
        opts.frame_opts.snip_edges = true;
        let computer = FbankComputer::new(opts).ok()?;
        let mut online = OnlineFeature::new(FeatureComputer::Fbank(computer));
        // wespeaker ждёт амплитуду в шкале int16.
        let scaled: Vec<f32> = samples.iter().map(|x| x * 32768.0).collect();
        online.accept_waveform(SR as f32, &scaled);
        online.input_finished();
        let frames = online.features;
        if frames.len() < 10 {
            return None;
        }
        let dim = frames[0].len();
        if dim != 80 {
            return None;
        }
        let mut mean = vec![0f32; dim];
        for f in &frames {
            for (m, x) in mean.iter_mut().zip(f) {
                *m += x;
            }
        }
        for m in mean.iter_mut() {
            *m /= frames.len() as f32;
        }
        let mut out = Vec::with_capacity(frames.len() * dim);
        for f in &frames {
            out.extend(f.iter().zip(&mean).map(|(x, m)| x - m));
        }
        Some(out)
    }

    /// Читает WAV (моно i16) в f32 [-1, 1].
    fn read_wav_f32(path: &Path) -> AppResult<Vec<f32>> {
        let reader = hound::WavReader::open(path).map_err(|e| AppError::Audio(e.to_string()))?;
        reader
            .into_samples::<i16>()
            .map(|s| s.map(|v| v as f32 / 32768.0))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Audio(e.to_string()))
    }

    impl Diarizer for OnnxDiarizer {
        fn diarize(&self, wav_16k_mono: &Path) -> AppResult<Vec<DiarSegment>> {
            let windows = self.embed(wav_16k_mono, &|_, _| {})?;
            Ok(crate::cluster::diarize_windows(&windows, self.num_speakers))
        }
    }
}

#[cfg(feature = "diarize")]
pub use engine::{ensure_models, EmbedProgress, OnnxDiarizer};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_returns_empty() {
        let d = MockDiarizer;
        assert!(d.diarize(Path::new("/x/audio.wav")).unwrap().is_empty());
    }
}
