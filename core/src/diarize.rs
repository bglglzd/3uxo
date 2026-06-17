//! Диаризация — «кто когда говорил». Трейт и мок доступны всегда; реальный
//! движок (native-pyannote-rs, инференс на Burn) прячется за cargo-фичей
//! `diarize` (тяжёлые ML-зависимости; модели качаются как и у whisper).
//!
//! Результат — `Vec<DiarSegment>`, который склеивается с текстом whisper через
//! [`crate::transcript::assign_speakers`].

use std::path::Path;

use crate::error::AppResult;
use crate::transcript::DiarSegment;

/// Источник разметки говорящих по одному моно-WAV (16 кГц).
/// Реализуется так же, как `Recorder`/`Transcriber`, чтобы движок можно было
/// подменить, не трогая остальной код.
pub trait Diarizer: Send + Sync {
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

// ── Реальный движок (Burn) за фичей `diarize` ───────────────────────────────
#[cfg(feature = "diarize")]
mod engine {
    use std::io::{Read, Write};
    use std::path::{Path, PathBuf};

    use crate::error::{AppError, AppResult};
    use crate::transcript::DiarSegment;

    use super::Diarizer;

    // Модели (.bpk, Burn) исключены из крейта native-pyannote-rs — качаем их при
    // первом запуске (как whisper-модель). URL запинены на коммит, с которого
    // опубликован native-pyannote-rs 0.1.4, чтобы файлы не «уехали».
    const COMMIT: &str = "97ac8d6f91510e01395c7b6569775acb70136ab5";
    const SEG_MIN_BYTES: u64 = 5_000_000; // реально ~5.8 МБ
    const EMB_MIN_BYTES: u64 = 25_000_000; // реально ~27.7 МБ
    /// Доля прогресса на сегментационную модель (она меньше эмбеддинговой).
    const SEG_WEIGHT: f32 = 0.175;
    /// Максимум говорящих (как в примере крейта).
    const MAX_SPEAKERS: usize = 6;
    /// Порог косинусной близости для отнесения к существующему говорящему.
    const THRESHOLD: f32 = 0.5;

    fn seg_url() -> String {
        format!("https://raw.githubusercontent.com/RustedBytes/pyannote-rs/{COMMIT}/src/nn/segmentation/model.bpk")
    }
    fn emb_url() -> String {
        format!("https://raw.githubusercontent.com/RustedBytes/pyannote-rs/{COMMIT}/src/nn/speaker_identification/model.bpk")
    }

    /// Скачивает файл во временный `.part` и переименовывает; зовёт `report(0..=1)`.
    fn download_to(url: &str, dst: &Path, report: &dyn Fn(f32)) -> AppResult<()> {
        let resp = ureq::get(url)
            .call()
            .map_err(|e| AppError::Audio(format!("download diarize model: {e}")))?;
        let total: u64 = resp
            .header("Content-Length")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let tmp = dst.with_extension("part");
        {
            let mut reader = resp.into_reader();
            let mut file = std::fs::File::create(&tmp)?;
            let mut buf = [0u8; 65536];
            let mut got: u64 = 0;
            loop {
                let n = reader.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                file.write_all(&buf[..n])?;
                got += n as u64;
                if total > 0 {
                    report(got as f32 / total as f32);
                }
            }
        }
        std::fs::rename(&tmp, dst)?;
        Ok(())
    }

    /// Гарантирует наличие обеих моделей в `<data_dir>/models/diarize`,
    /// скачивая при первом обращении (прогресс 0.0..=1.0 на обе вместе).
    pub fn ensure_models(data_dir: &Path, on_progress: &dyn Fn(f32)) -> AppResult<(PathBuf, PathBuf)> {
        let dir = data_dir.join("models").join("diarize");
        std::fs::create_dir_all(&dir)?;
        let seg = dir.join("segmentation.bpk");
        let emb = dir.join("embedding.bpk");

        if !(seg.exists() && std::fs::metadata(&seg)?.len() > SEG_MIN_BYTES) {
            download_to(&seg_url(), &seg, &|f| on_progress(f * SEG_WEIGHT))?;
        }
        if !(emb.exists() && std::fs::metadata(&emb)?.len() > EMB_MIN_BYTES) {
            download_to(&emb_url(), &emb, &|f| on_progress(SEG_WEIGHT + f * (1.0 - SEG_WEIGHT)))?;
        }
        on_progress(1.0);
        Ok((seg, emb))
    }

    /// Диаризатор на native-pyannote-rs (segmentation-3.0 + wespeaker, Burn).
    pub struct PyannoteDiarizer {
        segmenter: pyannote_rs::Segmenter,
        extractor: pyannote_rs::EmbeddingExtractor,
    }

    impl PyannoteDiarizer {
        /// Гарантирует модели (скачивает с прогрессом при необходимости) и
        /// загружает их в память.
        pub fn managed(data_dir: &Path, on_download: &dyn Fn(f32)) -> AppResult<Self> {
            let (seg_path, emb_path) = ensure_models(data_dir, on_download)?;
            let segmenter = pyannote_rs::Segmenter::new(&seg_path)
                .map_err(|e| AppError::Audio(format!("diarize: load segmentation: {e}")))?;
            let extractor = pyannote_rs::EmbeddingExtractor::new(&emb_path)
                .map_err(|e| AppError::Audio(format!("diarize: load embedding: {e}")))?;
            Ok(Self { segmenter, extractor })
        }
    }

    /// Читает WAV (моно i16) — формат `audio.wav` импортированной встречи.
    fn read_wav_i16(path: &Path) -> AppResult<(Vec<i16>, u32)> {
        let reader = hound::WavReader::open(path).map_err(|e| AppError::Audio(e.to_string()))?;
        let sample_rate = reader.spec().sample_rate;
        let samples = reader
            .into_samples::<i16>()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Audio(e.to_string()))?;
        Ok((samples, sample_rate))
    }

    impl Diarizer for PyannoteDiarizer {
        fn diarize(&self, wav_16k_mono: &Path) -> AppResult<Vec<DiarSegment>> {
            let (samples, sample_rate) = read_wav_i16(wav_16k_mono)?;
            let segments = self
                .segmenter
                .segments(&samples, sample_rate)
                .map_err(|e| AppError::Audio(format!("diarize: segmentation: {e}")))?;

            let mut manager = pyannote_rs::EmbeddingManager::new(MAX_SPEAKERS);
            let mut out = Vec::with_capacity(segments.len());
            for seg in segments {
                // Слишком короткий участок может не дать эмбеддинг — просто пропускаем.
                let embedding = match self.extractor.extract(&seg.samples, sample_rate) {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                let speaker = if manager.is_full() {
                    manager.best_match(&embedding)
                } else {
                    manager.upsert(&embedding, THRESHOLD)
                }
                .unwrap_or(0);
                out.push(DiarSegment {
                    start_secs: seg.start,
                    end_secs: seg.end,
                    speaker: speaker as u32,
                });
            }
            Ok(out)
        }
    }
}

#[cfg(feature = "diarize")]
pub use engine::{ensure_models, PyannoteDiarizer};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_returns_empty() {
        let d = MockDiarizer;
        assert!(d.diarize(Path::new("/x/audio.wav")).unwrap().is_empty());
    }
}
