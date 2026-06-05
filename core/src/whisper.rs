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

use std::path::{Path, PathBuf};

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::error::{AppError, AppResult};
use crate::transcriber::Transcriber;
use crate::transcript::Segment;

/// Транскрайбер на локальной модели Whisper.
pub struct WhisperTranscriber {
    model_path: PathBuf,
    /// Код языка (напр. "ru"); `None` — автоопределение.
    language: Option<String>,
}

impl WhisperTranscriber {
    pub fn new(model_path: impl Into<PathBuf>, language: Option<String>) -> Self {
        Self {
            model_path: model_path.into(),
            language,
        }
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
}

impl Transcriber for WhisperTranscriber {
    fn transcribe(&self, wav_path: &Path) -> AppResult<Vec<Segment>> {
        let audio = Self::read_wav_as_f32(wav_path)?;
        if audio.is_empty() {
            return Ok(Vec::new());
        }

        let ctx = WhisperContext::new_with_params(
            &self.model_path.to_string_lossy(),
            WhisperContextParameters::default(),
        )
        .map_err(|e| AppError::Audio(format!("whisper: cannot load model: {e}")))?;
        let mut state = ctx
            .create_state()
            .map_err(|e| AppError::Audio(format!("whisper: create_state: {e}")))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        if let Some(lang) = &self.language {
            params.set_language(Some(lang));
        }
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        state
            .full(params, &audio)
            .map_err(|e| AppError::Audio(format!("whisper: full: {e}")))?;

        let n = state
            .full_n_segments()
            .map_err(|e| AppError::Audio(e.to_string()))?;
        let mut segments = Vec::with_capacity(n as usize);
        for i in 0..n {
            let text = state
                .full_get_segment_text(i)
                .map_err(|e| AppError::Audio(e.to_string()))?;
            let t0 = state
                .full_get_segment_t0(i)
                .map_err(|e| AppError::Audio(e.to_string()))?;
            let t1 = state
                .full_get_segment_t1(i)
                .map_err(|e| AppError::Audio(e.to_string()))?;
            // Таймкоды whisper — в сотых долях секунды.
            segments.push(Segment {
                start_secs: t0 as f64 / 100.0,
                end_secs: t1 as f64 / 100.0,
                text: text.trim().to_string(),
            });
        }
        Ok(segments)
    }
}
