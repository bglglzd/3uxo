//! Реальная транскрибация на Whisper (whisper.cpp через `whisper-rs`).
//!
//! Включается только с cargo-фичей `whisper` (тяжёлая C++-сборка + файл
//! модели). На Linux-сервере разработки без GTK это не собирается и не
//! проверяется — код предназначен для сборки на Windows:
//! `cargo build --features whisper` (нужен файл модели ggml, напр.
//! `ggml-medium.bin`, для русского лучше medium/large).
//!
//! Ожидаемый формат входа — то, что пишет рекордер: WAV PCM, моно, 16 кГц,
//! 16 бит (см. `crate::audio`). Whisper как раз хочет 16 кГц f32 моно.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::error::{AppError, AppResult};
use crate::transcriber::Transcriber;
use crate::transcript::Segment;

/// Транскрайбер на локальной модели Whisper (модель грузится в память один раз).
pub struct WhisperTranscriber {
    ctx: WhisperContext,
    /// Код языка (напр. "ru"); `None` — автоопределение.
    language: Option<String>,
}

/// Размер модели по умолчанию (medium — заметно лучше для русского, ~1.5 ГБ).
pub const DEFAULT_MODEL_SIZE: &str = "medium";

/// Длина окна (сек) при пооконной расшифровке — для прогресса и памяти.
pub const DEFAULT_WINDOW_SECS: usize = 60;
const SAMPLE_RATE: usize = 16_000;

/// Порог энергии (RMS) участка: ниже — считаем тишиной и отбрасываем реплику
/// как галлюцинацию whisper (типа «Спасибо за внимание» на молчании).
const SILENCE_RMS: f32 = 0.01;

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples.iter().map(|&s| s as f64 * s as f64).sum();
    (sum / samples.len() as f64).sqrt() as f32
}

/// Гарантирует наличие ggml-модели нужного размера в `<data_dir>/models`,
/// скачивая её с HuggingFace при первом обращении (с прогрессом 0.0..=1.0).
/// Качается только модель (не данные пользователя); транскрибация — локально.
pub fn ensure_model(
    data_dir: &Path,
    size: &str,
    on_progress: &dyn Fn(f32),
) -> AppResult<PathBuf> {
    let models_dir = data_dir.join("models");
    std::fs::create_dir_all(&models_dir)?;
    let path = models_dir.join(format!("ggml-{size}.bin"));
    if path.exists() && std::fs::metadata(&path)?.len() > 1_000_000 {
        return Ok(path);
    }
    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{size}.bin"
    );
    let resp = ureq::get(&url)
        .call()
        .map_err(|e| AppError::Http(format!("download model: {e}")))?;
    let total: u64 = resp
        .header("Content-Length")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let tmp = path.with_extension("part");
    {
        let mut reader = resp.into_reader();
        let mut file = std::fs::File::create(&tmp)?;
        let mut buf = [0u8; 65536];
        let mut downloaded: u64 = 0;
        loop {
            let n = reader.read(&mut buf)?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])?;
            downloaded += n as u64;
            if total > 0 {
                on_progress(downloaded as f32 / total as f32);
            }
        }
    }
    std::fs::rename(&tmp, &path)?;
    on_progress(1.0);
    Ok(path)
}

impl WhisperTranscriber {
    /// Встроенный движок: гарантирует модель (скачивает с прогрессом при
    /// необходимости), грузит её в память один раз и возвращает транскрайбер.
    pub fn managed(
        data_dir: &Path,
        size: Option<&str>,
        language: Option<String>,
        on_download: &dyn Fn(f32),
    ) -> AppResult<Self> {
        let size = size.filter(|s| !s.is_empty()).unwrap_or(DEFAULT_MODEL_SIZE);
        let model_path = ensure_model(data_dir, size, on_download)?;
        // По умолчанию — русский. Пусто/не задано → "ru"; "auto" → автоопределение.
        let language = match language {
            Some(l) if !l.is_empty() => Some(l),
            _ => Some("ru".to_string()),
        };
        let ctx = WhisperContext::new_with_params(
            &model_path,
            WhisperContextParameters::default(),
        )
        .map_err(|e| AppError::Audio(format!("whisper: cannot load model: {e}")))?;
        Ok(Self { ctx, language })
    }

    /// Читает WAV (i16 моно) и нормализует в f32 [-1.0, 1.0].
    fn read_wav_as_f32(path: &Path) -> AppResult<Vec<f32>> {
        let reader = hound::WavReader::open(path).map_err(|e| AppError::Audio(e.to_string()))?;
        let samples: Vec<f32> = reader
            .into_samples::<i16>()
            .map(|s| s.map(|v| v as f32 / 32768.0))
            .collect::<Result<_, _>>()
            .map_err(|e| AppError::Audio(e.to_string()))?;
        Ok(samples)
    }

    /// Расшифровка пооконно: модель грузится один раз, аудио идёт окнами по
    /// `window_secs` секунд, после каждого окна зовётся `on_progress(0.0..=1.0)`.
    /// Прогресс идёт из нашего цикла (без FFI-колбэка whisper, который ронял
    /// приложение). Подходит для очень длинных записей (память ограничена окном).
    pub fn transcribe_windowed(
        &self,
        wav_path: &Path,
        window_secs: usize,
        on_progress: &dyn Fn(usize, usize),
    ) -> AppResult<Vec<Segment>> {
        let audio = Self::read_wav_as_f32(wav_path)?;
        if audio.is_empty() {
            return Ok(Vec::new());
        }

        let ctx = &self.ctx;
        let win = window_secs.max(1) * SAMPLE_RATE;
        let total = audio.len().div_ceil(win).max(1);
        let mut segments = Vec::new();

        // Число потоков по ядрам CPU (whisper по умолчанию берёт мало → медленно).
        let n_threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .clamp(1, 8) as std::os::raw::c_int;

        for (i, chunk) in audio.chunks(win).enumerate() {
            let mut state = ctx
                .create_state()
                .map_err(|e| AppError::Audio(format!("whisper: create_state: {e}")))?;

            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            params.set_n_threads(n_threads);
            match self.language.as_deref() {
                Some("auto") | None => {}
                Some(lang) => params.set_language(Some(lang)),
            }
            params.set_translate(false);
            // Не опираться на предыдущий текст — меньше зацикленных галлюцинаций.
            params.set_no_context(true);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);

            state
                .full(params, chunk)
                .map_err(|e| AppError::Audio(format!("whisper: full: {e}")))?;

            let offset = (i * win) as f64 / SAMPLE_RATE as f64;
            let n = state.full_n_segments();
            for s in 0..n {
                let Some(seg) = state.get_segment(s) else {
                    continue;
                };
                let text = seg
                    .to_str_lossy()
                    .map_err(|e| AppError::Audio(e.to_string()))?
                    .trim()
                    .to_string();
                if text.is_empty() {
                    continue;
                }
                // Таймкоды whisper — в сотых долях секунды (внутри окна).
                let t0c = seg.start_timestamp().max(0) as usize;
                let t1c = seg.end_timestamp().max(0) as usize;
                // Отбрасываем галлюцинации на тишине: если участок реплики
                // в исходном аудио почти беззвучный — это выдумка whisper.
                let a = (t0c * SAMPLE_RATE / 100).min(chunk.len());
                let b = (t1c * SAMPLE_RATE / 100).min(chunk.len());
                if b > a && rms(&chunk[a..b]) < SILENCE_RMS {
                    continue;
                }
                segments.push(Segment {
                    start_secs: offset + t0c as f64 / 100.0,
                    end_secs: offset + t1c as f64 / 100.0,
                    text,
                });
            }
            on_progress(i + 1, total);
        }
        Ok(segments)
    }
}

impl Transcriber for WhisperTranscriber {
    fn transcribe(&self, wav_path: &Path) -> AppResult<Vec<Segment>> {
        self.transcribe_windowed(wav_path, DEFAULT_WINDOW_SECS, &|_, _| {})
    }
}
