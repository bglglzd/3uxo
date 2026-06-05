use crate::error::{AppError, AppResult};
use std::path::Path;

const SAMPLE_RATE: u32 = 16_000;

/// Записывает `secs` секунд тишины в WAV-файл (моно, 16 кГц, 16 бит).
pub fn write_silence_wav(path: &Path, secs: u64) -> AppResult<()> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        hound::WavWriter::create(path, spec).map_err(|e| AppError::Audio(e.to_string()))?;
    let total = SAMPLE_RATE as u64 * secs;
    for _ in 0..total {
        writer
            .write_sample(0i16)
            .map_err(|e| AppError::Audio(e.to_string()))?;
    }
    writer
        .finalize()
        .map_err(|e| AppError::Audio(e.to_string()))?;
    Ok(())
}

/// Возвращает длительность WAV-файла в секундах (округление вниз).
pub fn wav_duration_secs(path: &Path) -> AppResult<u64> {
    let reader = hound::WavReader::open(path).map_err(|e| AppError::Audio(e.to_string()))?;
    let spec = reader.spec();
    let frames = reader.len() as u64 / spec.channels as u64;
    Ok(frames / spec.sample_rate as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_measures_three_seconds() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.wav");
        write_silence_wav(&path, 3).unwrap();
        assert!(path.exists());
        assert_eq!(wav_duration_secs(&path).unwrap(), 3);
    }
}
