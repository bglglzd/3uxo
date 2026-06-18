//! Декодирование произвольных аудиофайлов (телефоны, диктофоны) в формат
//! конвейера: WAV PCM, моно, 16 кГц, 16 бит — тот же, что пишет рекордер
//! (см. [`crate::audio`]) и который ждёт whisper.
//!
//! Чистый Rust (`symphonia` + `rubato`), без внешних установок и без cargo-фич,
//! поэтому собирается и тестируется на любой ОС. Покрывает популярные форматы:
//! WAV, MP3, M4A/AAC (iPhone Voice Memos), FLAC, OGG/Vorbis, AIFF, CAF.

use std::path::Path;

use rubato::{FftFixedIn, Resampler};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::error::{AppError, AppResult};

const TARGET_RATE: u32 = 16_000;

/// Список поддерживаемых форматов — для понятного текста ошибки.
#[cfg(feature = "opus")]
pub const SUPPORTED: &str = "WAV, MP3, M4A/AAC, FLAC, OGG (Vorbis/Opus), AIFF, CAF";
#[cfg(not(feature = "opus"))]
pub const SUPPORTED: &str = "WAV, MP3, M4A/AAC, FLAC, OGG/Vorbis, AIFF, CAF";

/// Декодирует любой поддерживаемый аудиофайл в WAV (моно, 16 кГц, 16 бит).
pub fn decode_to_wav_16k_mono(src: &Path, dst: &Path) -> AppResult<()> {
    let (mono, src_rate) = match decode_to_mono_f32(src) {
        Ok(r) => r,
        Err(e) => {
            // symphonia не умеет Opus — пробуем отдельный путь Ogg/Opus.
            #[cfg(feature = "opus")]
            {
                match opus::decode_ogg_opus_16k_mono(src) {
                    Ok(r) => r,
                    // Не Opus (или битый) — возвращаем исходную ошибку symphonia.
                    Err(_) => return Err(e),
                }
            }
            #[cfg(not(feature = "opus"))]
            {
                return Err(e);
            }
        }
    };
    let resampled = resample_to_16k(&mono, src_rate)?;
    write_wav_i16(dst, &resampled)?;
    Ok(())
}

/// Декодирует файл в моно f32 [-1.0, 1.0]; возвращает сэмплы и их частоту.
fn decode_to_mono_f32(src: &Path) -> AppResult<(Vec<f32>, u32)> {
    let file = std::fs::File::open(src)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = src.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|_| {
            AppError::Audio(format!(
                "неподдерживаемый или повреждённый аудиофайл; поддерживаются: {SUPPORTED}"
            ))
        })?;
    let mut format = probed.format;

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| AppError::Audio("в файле нет аудиодорожки".into()))?;
    let track_id = track.id;
    let codec_params = track.codec_params.clone();

    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|_| {
            AppError::Audio(format!(
                "кодек не поддерживается; поддерживаются: {SUPPORTED}"
            ))
        })?;

    let mut mono: Vec<f32> = Vec::new();
    let mut rate: u32 = 0;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            // Нормальный конец потока.
            Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymError::ResetRequired) => break,
            Err(e) => return Err(AppError::Audio(format!("чтение аудио: {e}"))),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                if rate == 0 {
                    rate = spec.rate;
                }
                let channels = spec.channels.count().max(1);
                let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                buf.copy_interleaved_ref(decoded);
                let samples = buf.samples();
                if channels == 1 {
                    mono.extend_from_slice(samples);
                } else {
                    // Даунмикс в моно усреднением каналов.
                    for frame in samples.chunks(channels) {
                        let sum: f32 = frame.iter().copied().sum();
                        mono.push(sum / channels as f32);
                    }
                }
            }
            // Битый пакет — пропускаем, не валим всю расшифровку.
            Err(SymError::DecodeError(_)) => continue,
            Err(e) => return Err(AppError::Audio(format!("декодирование: {e}"))),
        }
    }

    if mono.is_empty() || rate == 0 {
        return Err(AppError::Audio(
            "не удалось декодировать аудио (пустой поток)".into(),
        ));
    }
    Ok((mono, rate))
}

/// Ресемпл моно-сигнала в 16 кГц (FFT-ресемплер с антиалиасингом).
fn resample_to_16k(input: &[f32], src_rate: u32) -> AppResult<Vec<f32>> {
    if src_rate == TARGET_RATE {
        return Ok(input.to_vec());
    }
    if input.is_empty() {
        return Ok(Vec::new());
    }
    const CHUNK: usize = 1024;
    let mut resampler =
        FftFixedIn::<f32>::new(src_rate as usize, TARGET_RATE as usize, CHUNK, 2, 1)
            .map_err(|e| AppError::Audio(format!("инициализация ресемплера: {e}")))?;

    // Дополняем нулями до кратности CHUNK и гоним фиксированными окнами —
    // так не нужен ручной partial/flush (хвост тишины несущественен для STT).
    let mut padded = input.to_vec();
    let rem = padded.len() % CHUNK;
    if rem != 0 {
        padded.resize(padded.len() + (CHUNK - rem), 0.0);
    }

    let approx = input.len() * TARGET_RATE as usize / src_rate as usize + CHUNK;
    let mut out: Vec<f32> = Vec::with_capacity(approx);
    for frame in padded.chunks(CHUNK) {
        let waves_in = vec![frame.to_vec()];
        let waves_out = resampler
            .process(&waves_in, None)
            .map_err(|e| AppError::Audio(format!("ресемпл: {e}")))?;
        out.extend_from_slice(&waves_out[0]);
    }
    Ok(out)
}

/// Пишет f32-сэмплы в WAV (моно, 16 кГц, 16 бит) через `hound`.
fn write_wav_i16(dst: &Path, samples: &[f32]) -> AppResult<()> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        hound::WavWriter::create(dst, spec).map_err(|e| AppError::Audio(e.to_string()))?;
    for &s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
        writer
            .write_sample(v)
            .map_err(|e| AppError::Audio(e.to_string()))?;
    }
    writer
        .finalize()
        .map_err(|e| AppError::Audio(e.to_string()))?;
    Ok(())
}

// ── Ogg/Opus за фичей `opus` (symphonia Opus не декодирует) ─────────────────
#[cfg(feature = "opus")]
mod opus {
    use std::path::Path;

    use audiopus::coder::Decoder;
    use audiopus::{Channels, SampleRate};
    use ogg::reading::PacketReader;

    use crate::error::{AppError, AppResult};

    /// Декодирует Ogg/Opus (например, голосовое из мессенджера) в моно f32 16 кГц
    /// напрямую (libopus сам ресемплит до 16 кГц). Возвращает (сэмплы, 16000).
    pub fn decode_ogg_opus_16k_mono(src: &Path) -> AppResult<(Vec<f32>, u32)> {
        let file = std::fs::File::open(src)?;
        let mut reader = PacketReader::new(file);

        let mut channels: usize = 1;
        let mut pre_skip_48k: u32 = 0;
        let mut decoder: Option<Decoder> = None;
        let mut interleaved: Vec<i16> = Vec::new();
        // Запас: максимум 120 мс при 48 кГц на 2 канала (с лихвой для 16 кГц).
        let mut buf = vec![0i16; 5760 * 2];
        let mut pkt_index = 0usize;

        loop {
            let packet = match reader.read_packet() {
                Ok(Some(p)) => p,
                Ok(None) => break,
                Err(e) => return Err(AppError::Audio(format!("ogg: {e}"))),
            };
            let data = &packet.data;
            if pkt_index == 0 {
                // OpusHead: магия(8) ver(1) channels(1) pre-skip(2 LE) ...
                if data.len() < 12 || &data[0..8] != b"OpusHead" {
                    return Err(AppError::Audio("не Ogg/Opus".into()));
                }
                channels = data[9] as usize;
                pre_skip_48k = u16::from_le_bytes([data[10], data[11]]) as u32;
                let ch = if channels >= 2 {
                    Channels::Stereo
                } else {
                    Channels::Mono
                };
                decoder = Some(
                    Decoder::new(SampleRate::Hz16000, ch)
                        .map_err(|e| AppError::Audio(format!("opus decoder: {e}")))?,
                );
            } else if pkt_index == 1 {
                // OpusTags — пропускаем.
            } else if let Some(dec) = decoder.as_mut() {
                let ch = channels.clamp(1, 2);
                let n = dec
                    .decode(Some(&data[..]), &mut buf[..], false)
                    .map_err(|e| AppError::Audio(format!("opus decode: {e}")))?;
                interleaved.extend_from_slice(&buf[..n * ch]);
            }
            pkt_index += 1;
        }

        if decoder.is_none() || interleaved.is_empty() {
            return Err(AppError::Audio("opus: пустой поток".into()));
        }

        let ch = channels.clamp(1, 2);
        // pre-skip задан в 48 кГц; на выходе 16 кГц → делим на 3 (сэмплов/канал).
        let skip = ((pre_skip_48k / 3) as usize * ch).min(interleaved.len());
        let samples = &interleaved[skip..];

        // Даунмикс в моно + i16 → f32 [-1, 1].
        let mut mono = Vec::with_capacity(samples.len() / ch + 1);
        if ch == 1 {
            mono.extend(samples.iter().map(|&s| s as f32 / 32768.0));
        } else {
            for frame in samples.chunks(ch) {
                let sum: i32 = frame.iter().map(|&x| x as i32).sum();
                mono.push(sum as f32 / ch as f32 / 32768.0);
            }
        }
        Ok((mono, 16_000))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Пишет синус в WAV нужной частоты/каналов (для проверки декода+ресемпла).
    fn write_sine_wav(path: &Path, rate: u32, channels: u16, secs: f32, freq: f32) {
        let spec = hound::WavSpec {
            channels,
            sample_rate: rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::create(path, spec).unwrap();
        let total = (rate as f32 * secs) as u32;
        for i in 0..total {
            let t = i as f32 / rate as f32;
            let v = (2.0 * std::f32::consts::PI * freq * t).sin();
            let s = (v * 30_000.0) as i16;
            for _ in 0..channels {
                w.write_sample(s).unwrap();
            }
        }
        w.finalize().unwrap();
    }

    #[test]
    fn decodes_and_resamples_stereo_48k_to_mono_16k() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("in.wav");
        let dst = dir.path().join("out.wav");
        write_sine_wav(&src, 48_000, 2, 1.0, 440.0);

        decode_to_wav_16k_mono(&src, &dst).unwrap();

        let reader = hound::WavReader::open(&dst).unwrap();
        let spec = reader.spec();
        assert_eq!(spec.sample_rate, 16_000);
        assert_eq!(spec.channels, 1);
        // Моно ⇒ число сэмплов == число кадров ≈ 1 c при 16 кГц.
        let n = reader.len() as i64;
        assert!((n - 16_000).abs() < 2_000, "got {n} samples");
    }

    #[test]
    fn passthrough_when_already_16k_mono() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("in16.wav");
        let dst = dir.path().join("out16.wav");
        write_sine_wav(&src, 16_000, 1, 0.5, 220.0);

        decode_to_wav_16k_mono(&src, &dst).unwrap();

        let reader = hound::WavReader::open(&dst).unwrap();
        assert_eq!(reader.spec().sample_rate, 16_000);
        assert_eq!(reader.spec().channels, 1);
        let n = reader.len() as i64;
        assert!((n - 8_000).abs() < 100, "got {n} samples");
    }

    #[test]
    fn unsupported_file_is_error() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("not-audio.bin");
        std::fs::write(&p, b"this is definitely not audio data").unwrap();
        let out = dir.path().join("o.wav");
        assert!(decode_to_wav_16k_mono(&p, &out).is_err());
    }
}
