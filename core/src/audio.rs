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

/// Потоковый линейный ресемплер «любая частота → 16 кГц моно» для живого
/// захвата (кадры приходят кусками из аудио-колбэков). Для речи линейной
/// интерполяции достаточно: перед распознаванием дорожка ещё раз проходит
/// через декодер импорта.
pub struct StreamResampler {
    /// Шаг по входу на один выходной сэмпл: in_rate / 16000.
    step: f64,
    /// Позиция следующего выходного сэмпла относительно `prev` (0..1…).
    pos: f64,
    prev: f32,
    primed: bool,
}

impl StreamResampler {
    pub fn new(in_rate: u32) -> Self {
        Self {
            step: in_rate.max(1) as f64 / SAMPLE_RATE as f64,
            pos: 0.0,
            prev: 0.0,
            primed: false,
        }
    }

    /// Принимает `frames` кадров с `channels` каналами (interleaved), сводит в
    /// моно и дописывает выход (16 кГц) в `out`.
    pub fn push(&mut self, interleaved: &[f32], channels: usize, out: &mut Vec<f32>) {
        let ch = channels.max(1);
        for frame in interleaved.chunks(ch) {
            let x = frame.iter().sum::<f32>() / frame.len() as f32;
            if !self.primed {
                self.prev = x;
                self.primed = true;
                out.push(x);
                self.pos = self.step;
                continue;
            }
            // Выходные сэмплы между prev (t=0) и x (t=1).
            while self.pos <= 1.0 {
                let t = self.pos as f32;
                out.push(self.prev + (x - self.prev) * t);
                self.pos += self.step;
            }
            self.pos -= 1.0;
            self.prev = x;
        }
    }
}

/// Приёмник одной дорожки живой записи: принимает куски звука любой частоты
/// и каналов, пишет WAV 16 кГц моно i16 и копит пиковый уровень для индикатора.
pub struct TrackSink {
    writer: Option<hound::WavWriter<std::io::BufWriter<std::fs::File>>>,
    resampler: StreamResampler,
    buf: Vec<f32>,
    written: u64,
    /// Пик |x| (0..32767) с прошлого опроса уровня.
    pub peak: std::sync::Arc<std::sync::atomic::AtomicU32>,
}

impl TrackSink {
    pub fn create(path: &Path, in_rate: u32) -> AppResult<Self> {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: SAMPLE_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let writer =
            hound::WavWriter::create(path, spec).map_err(|e| AppError::Audio(e.to_string()))?;
        Ok(Self {
            writer: Some(writer),
            resampler: StreamResampler::new(in_rate),
            buf: Vec::new(),
            written: 0,
            peak: Default::default(),
        })
    }

    /// Частота входа изменилась (напр. устройство переподключили).
    pub fn set_input_rate(&mut self, in_rate: u32) {
        self.resampler = StreamResampler::new(in_rate);
    }

    /// Дописывает кусок звука (interleaved f32).
    pub fn push(&mut self, interleaved: &[f32], channels: usize) {
        let Some(w) = self.writer.as_mut() else { return };
        self.buf.clear();
        self.resampler.push(interleaved, channels, &mut self.buf);
        let mut peak = 0u32;
        for &x in &self.buf {
            let v = f32_to_i16(x);
            peak = peak.max(v.unsigned_abs() as u32);
            if w.write_sample(v).is_ok() {
                self.written += 1;
            }
        }
        self.peak.fetch_max(peak, std::sync::atomic::Ordering::Relaxed);
    }

    /// Сколько секунд записано.
    pub fn secs(&self) -> f64 {
        self.written as f64 / SAMPLE_RATE as f64
    }

    /// Закрывает WAV (заголовок с длиной). Повторный вызов — без эффекта.
    pub fn finalize(&mut self) -> AppResult<()> {
        if let Some(w) = self.writer.take() {
            w.finalize().map_err(|e| AppError::Audio(e.to_string()))?;
        }
        Ok(())
    }
}

/// f32 [-1, 1] → i16 с насыщением.
pub fn f32_to_i16(x: f32) -> i16 {
    (x.clamp(-1.0, 1.0) * 32767.0).round() as i16
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
    fn stream_resampler_rates_and_mono_mix() {
        // 48 кГц стерео, 1 секунда кусками → ~16000 моно-сэмплов.
        let mut r = StreamResampler::new(48_000);
        let mut out = Vec::new();
        let chunk: Vec<f32> = (0..960).flat_map(|_| [0.5f32, -0.5]).collect();
        for _ in 0..50 {
            r.push(&chunk, 2, &mut out);
        }
        assert!((out.len() as i64 - 16_000).abs() <= 2, "len {}", out.len());
        assert!(out.iter().all(|x| x.abs() < 1e-6), "стерео в противофазе → 0");

        // 16 кГц моно — без изменений длины.
        let mut r = StreamResampler::new(16_000);
        let mut out = Vec::new();
        let sig: Vec<f32> = (0..1600).map(|i| (i as f32 * 0.01).sin()).collect();
        r.push(&sig, 1, &mut out);
        assert!((out.len() as i64 - 1600).abs() <= 1);
        assert!((out[800] - sig[800]).abs() < 1e-3);

        // 44.1 кГц моно, куски разной длины.
        let mut r = StreamResampler::new(44_100);
        let mut out = Vec::new();
        let sig = vec![0.25f32; 44_100];
        for part in sig.chunks(333) {
            r.push(part, 1, &mut out);
        }
        assert!((out.len() as i64 - 16_000).abs() <= 2, "len {}", out.len());
        assert!(out.iter().all(|x| (x - 0.25).abs() < 1e-6));
        assert_eq!(f32_to_i16(2.0), 32767);
        assert_eq!(f32_to_i16(-1.0), -32767);
    }

    #[test]
    fn track_sink_writes_16k_mono_and_tracks_peak() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mic.wav");
        let mut sink = TrackSink::create(&path, 48_000).unwrap();
        let chunk: Vec<f32> = (0..4800).map(|i| if i % 2 == 0 { 0.5 } else { -0.5 }).collect();
        for _ in 0..10 {
            sink.push(&chunk, 1); // 10 × 0.1 с
        }
        assert!((sink.secs() - 1.0).abs() < 0.01);
        assert!(sink.peak.load(std::sync::atomic::Ordering::Relaxed) > 10_000);
        sink.finalize().unwrap();
        sink.finalize().unwrap();
        let r = hound::WavReader::open(&path).unwrap();
        assert_eq!(r.spec().sample_rate, 16_000);
        assert_eq!(r.spec().channels, 1);
        assert!((r.len() as i64 - 16_000).abs() <= 2);
    }

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
