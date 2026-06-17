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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_returns_empty() {
        let d = MockDiarizer;
        assert!(d.diarize(Path::new("/x/audio.wav")).unwrap().is_empty());
    }
}
