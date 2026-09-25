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

/// Границы окон для пооконной расшифровки: окна около `target` сэмплов, но
/// разрез ставится в самое тихое место (по RMS кадров длиной `frame`) внутри
/// последних `search` сэмплов окна — чтобы не резать слово пополам.
pub fn quiet_chunks(samples: &[f32], target: usize, search: usize, frame: usize) -> Vec<(usize, usize)> {
    let len = samples.len();
    let frame = frame.max(1);
    let target = target.max(frame * 2);
    let search = search.min(target / 2);
    let mut out = Vec::new();
    let mut start = 0usize;
    while start < len {
        let hard_end = start + target;
        // Хвост короче полуокна не отделяем — он уйдёт в текущее окно.
        if hard_end + target / 2 >= len {
            out.push((start, len));
            break;
        }
        let mut best = (hard_end, f32::INFINITY);
        let mut pos = hard_end - search;
        while pos + frame <= hard_end {
            let e: f32 = samples[pos..pos + frame].iter().map(|x| x * x).sum();
            if e < best.1 {
                best = (pos + frame / 2, e);
            }
            pos += frame;
        }
        out.push((start, best.0));
        start = best.0;
    }
    out
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
    fn quiet_chunks_cut_in_silence_and_cover_everything() {
        // 25 «секунд» по 100 сэмплов: громко, но тишина на 8.5 и 17.2 с.
        let sr = 100;
        let mut v = vec![0.5f32; 25 * sr];
        for x in &mut v[850..860] {
            *x = 0.0;
        }
        for x in &mut v[1720..1730] {
            *x = 0.0;
        }
        let c = quiet_chunks(&v, 10 * sr, 3 * sr, 10);
        assert_eq!(c.first().unwrap().0, 0);
        assert_eq!(c.last().unwrap().1, v.len());
        for w in c.windows(2) {
            assert_eq!(w[0].1, w[1].0);
        }
        assert_eq!(c[0].1, 855);
        assert!((1715..=1730).contains(&c[1].1), "cut {}", c[1].1);
        assert_eq!(c.len(), 3);
        // Короткий файл — одно окно.
        assert_eq!(quiet_chunks(&v[..300], 10 * sr, 3 * sr, 10), vec![(0, 300)]);
        assert!(quiet_chunks(&[], 1000, 300, 10).is_empty());
    }

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
