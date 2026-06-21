use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

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

/// Склеивает несколько WAV-частей (моно, 16 кГц, 16 бит i16) в один файл `dst`.
/// Используется для сборки сегментов записи (пауза/возобновление + восстановление
/// после сбоя) в единый `mic.wav`/`system.wav`. Части читаются по порядку
/// переданного списка. Битые/нечитаемые части ПРОПУСКАЮТСЯ (устойчивость
/// восстановления важнее строгости). Пустой список → валидный WAV нулевой длины.
pub fn concat_wavs(parts: &[PathBuf], dst: &Path) -> AppResult<()> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        hound::WavWriter::create(dst, spec).map_err(|e| AppError::Audio(e.to_string()))?;
    for part in parts {
        // Не валим всю склейку из-за одной битой части — пропускаем её.
        let reader = match hound::WavReader::open(part) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for sample in reader.into_samples::<i16>() {
            match sample {
                Ok(s) => writer
                    .write_sample(s)
                    .map_err(|e| AppError::Audio(e.to_string()))?,
                Err(_) => break, // обрыв внутри части — берём, что успели
            }
        }
    }
    writer
        .finalize()
        .map_err(|e| AppError::Audio(e.to_string()))?;
    Ok(())
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

    #[test]
    fn concat_sums_durations() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.wav");
        let b = dir.path().join("b.wav");
        write_silence_wav(&a, 1).unwrap();
        write_silence_wav(&b, 2).unwrap();
        let dst = dir.path().join("all.wav");
        concat_wavs(&[a, b], &dst).unwrap();
        assert_eq!(wav_duration_secs(&dst).unwrap(), 3);
    }

    #[test]
    fn concat_empty_writes_zero_length() {
        let dir = tempfile::tempdir().unwrap();
        let dst = dir.path().join("empty.wav");
        concat_wavs(&[], &dst).unwrap();
        assert!(dst.exists());
        assert_eq!(wav_duration_secs(&dst).unwrap(), 0);
    }

    #[test]
    fn concat_skips_missing_part() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.wav");
        write_silence_wav(&a, 2).unwrap();
        let missing = dir.path().join("nope.wav");
        let dst = dir.path().join("all.wav");
        concat_wavs(&[a, missing], &dst).unwrap();
        assert_eq!(wav_duration_secs(&dst).unwrap(), 2);
    }
}
