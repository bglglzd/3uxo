//! Реальный захват звука на Windows через WASAPI (крейт `wasapi`).
//!
//! Реализует [`crate::recorder::Recorder`], поэтому подменяет `MockRecorder`
//! без изменений в остальном коде. Пишет ДВЕ дорожки в формате конвейера
//! (WAV, моно, 16 кГц, 16 бит): микрофон («Я») и системный звук через
//! loopback («Собеседник»).
//!
//! # СТАТУС: не проверено на Linux-машине разработки
//! Код нельзя собрать без Windows + крейта `wasapi`. Написан по примеру
//! `wasapi/examples/loopback.rs`. Перед использованием см. риск-лист в
//! `docs/superpowers/plans/2026-06-04-3uxo-plan-2-wasapi-audio.md`.
//!
//! Ключевой приём: shared-режим с `autoconvert: true` просит WASAPI самому
//! сконвертировать поток устройства в запрошенные 16 кГц/моно/16 бит.

#![cfg(target_os = "windows")]

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use wasapi::{Direction, SampleType, ShareMode, WaveFormat};

use crate::audio::wav_duration_secs;
use crate::error::{AppError, AppResult};
use crate::recorder::{Recorder, RecordingResult};

const SAMPLE_RATE: u32 = 16_000;

/// Что захватываем: микрофон или системный звук (loopback).
#[derive(Clone, Copy)]
enum Source {
    Mic,
    Loopback,
}

/// Захватчик двух дорожек на WASAPI.
pub struct WasapiRecorder {
    running: Mutex<Option<Running>>,
}

struct Running {
    stop: Arc<AtomicBool>,
    mic: JoinHandle<AppResult<()>>,
    system: JoinHandle<AppResult<()>>,
    mic_path: PathBuf,
}

impl WasapiRecorder {
    pub fn new() -> Self {
        Self {
            running: Mutex::new(None),
        }
    }
}

impl Default for WasapiRecorder {
    fn default() -> Self {
        Self::new()
    }
}

impl Recorder for WasapiRecorder {
    fn start(&self, mic_path: &Path, system_path: &Path) -> AppResult<()> {
        let mut running = self.running.lock().unwrap();
        if running.is_some() {
            return Err(AppError::InvalidState("already recording".into()));
        }
        let stop = Arc::new(AtomicBool::new(false));

        let mic_pb = mic_path.to_path_buf();
        let sys_pb = system_path.to_path_buf();
        let stop_mic = stop.clone();
        let stop_sys = stop.clone();

        let mic = std::thread::spawn(move || capture_loop(mic_pb, Source::Mic, stop_mic));
        let system =
            std::thread::spawn(move || capture_loop(sys_pb, Source::Loopback, stop_sys));

        *running = Some(Running {
            stop,
            mic,
            system,
            mic_path: mic_path.to_path_buf(),
        });
        Ok(())
    }

    fn stop(&self) -> AppResult<RecordingResult> {
        let running = {
            let mut guard = self.running.lock().unwrap();
            guard
                .take()
                .ok_or_else(|| AppError::InvalidState("not recording".into()))?
        };
        running.stop.store(true, Ordering::Relaxed);
        // Дожидаемся ОБОИХ потоков (даже если один завершился ошибкой), чтобы
        // захват гарантированно прекратился и файлы дорожек закрылись. Ошибки
        // потока НЕ роняют остановку: пользователь нажал «стоп» — запись обязана
        // остановиться и сохраниться. Диагностика самих потоков уже в 3uxo.log
        // (reads/events_ok/samples/peak), её писать в момент join не нужно.
        let mic_join = running.mic.join();
        let sys_join = running.system.join();
        if mic_join.is_err() || matches!(&mic_join, Ok(Err(_))) {
            dlog(&running.mic_path, "stop: mic capture thread ended with error");
        }
        if sys_join.is_err() || matches!(&sys_join, Ok(Err(_))) {
            dlog(&running.mic_path, "stop: system capture thread ended with error");
        }

        let duration_secs = wav_duration_secs(&running.mic_path).unwrap_or(0);
        Ok(RecordingResult { duration_secs })
    }

    fn is_recording(&self) -> bool {
        self.running.lock().unwrap().is_some()
    }
}

/// Дописывает диагностику захвата в backend-лог. Путь выводим из пути дорожки:
/// `<data_root>/meetings/<id>/mic.wav` → `<data_root>/3uxo.log` (без проброса
/// data_root через сигнатуры).
fn dlog(track_path: &Path, msg: &str) {
    if let Some(root) = track_path.ancestors().nth(3) {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(root.join("3uxo.log"))
        {
            let _ = writeln!(f, "[wasapi] {msg}");
        }
    }
}

/// Поток захвата одной дорожки: открывает устройство, пишет WAV до сигнала stop.
fn capture_loop(path: PathBuf, source: Source, stop: Arc<AtomicBool>) -> AppResult<()> {
    let label = match source {
        Source::Mic => "mic",
        Source::Loopback => "system",
    };
    // COM в каждом потоке свой.
    let _ = wasapi::initialize_mta();

    // Микрофон берётся с Capture-устройства; системный звук — с Render-устройства
    // (loopback): получаем render-девайс, но клиент инициализируем как Capture.
    let device_direction = match source {
        Source::Mic => Direction::Capture,
        Source::Loopback => Direction::Render,
    };
    let device = wasapi::get_default_device(&device_direction)
        .map_err(|e| AppError::Audio(format!("wasapi: default device: {e}")))?;

    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|e| AppError::Audio(format!("wasapi: get_iaudioclient: {e}")))?;

    // Просим сразу нужный формат; последний аргумент `true` (convert) включает
    // авто-конвертацию WASAPI, чтобы получить 16 кГц/моно/16 бит из любого
    // формата устройства.
    let format = WaveFormat::new(16, 16, &SampleType::Int, SAMPLE_RATE as usize, 1, None);
    let blockalign = format.get_blockalign() as usize; // 2 байта для моно i16

    let (_def_time, min_time) = audio_client
        .get_periods()
        .map_err(|e| AppError::Audio(format!("wasapi: get_periods: {e}")))?;

    audio_client
        .initialize_client(
            &format,
            min_time,
            &Direction::Capture,
            &ShareMode::Shared,
            true,
        )
        .map_err(|e| AppError::Audio(format!("wasapi: initialize_client: {e}")))?;

    let h_event = audio_client
        .set_get_eventhandle()
        .map_err(|e| AppError::Audio(format!("wasapi: eventhandle: {e}")))?;
    let capture_client = audio_client
        .get_audiocaptureclient()
        .map_err(|e| AppError::Audio(format!("wasapi: capture_client: {e}")))?;

    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        hound::WavWriter::create(&path, spec).map_err(|e| AppError::Audio(e.to_string()))?;

    audio_client
        .start_stream()
        .map_err(|e| AppError::Audio(format!("wasapi: start_stream: {e}")))?;
    dlog(
        &path,
        &format!("{label}: stream started (blockalign={blockalign}, min_period={min_time})"),
    );

    // Диагностика: сколько раз читали, сколько раз событие сработало, сколько
    // сэмплов записали — чтобы понять, читает ли WASAPI данные вообще.
    let mut reads: u64 = 0;
    let mut events_ok: u64 = 0;
    let mut samples: u64 = 0;
    // Пиковая амплитуда (|сэмпл|, 0..32767): ~0 → захвачена тишина/нули (не то
    // устройство/нет сигнала); большое значение → реальный звук есть.
    let mut peak: i32 = 0;

    let mut queue: VecDeque<u8> = VecDeque::new();
    while !stop.load(Ordering::Relaxed) {
        capture_client
            .read_from_device_to_deque(&mut queue)
            .map_err(|e| AppError::Audio(format!("wasapi: read: {e}")))?;
        reads += 1;

        // Каждые `blockalign` байт = один моно-сэмпл i16 (LE).
        while queue.len() >= blockalign {
            let lo = queue.pop_front().unwrap();
            let hi = queue.pop_front().unwrap();
            // На случай blockalign>2 (не наш случай) — отбрасываем лишние байты кадра.
            for _ in 2..blockalign {
                queue.pop_front();
            }
            let sample = i16::from_le_bytes([lo, hi]);
            let amp = (sample as i32).abs();
            if amp > peak {
                peak = amp;
            }
            writer
                .write_sample(sample)
                .map_err(|e| AppError::Audio(e.to_string()))?;
            samples += 1;
        }

        // Микрофон (Capture) шлёт WASAPI-события — ждём их (эффективно, точно).
        // Системный звук (loopback/Render) в shared-режиме события НЕ шлёт
        // (диагностика: events_ok=0), поэтому опрашиваем буфер по короткому
        // таймеру — иначе системная дорожка остаётся пустой.
        match source {
            Source::Mic => {
                if h_event.wait_for_event(100).is_ok() {
                    events_ok += 1;
                }
            }
            Source::Loopback => {
                std::thread::sleep(std::time::Duration::from_millis(8));
            }
        }
    }

    dlog(
        &path,
        &format!(
            "{label}: stop — reads={reads}, events_ok={events_ok}, samples={samples}, peak={peak}"
        ),
    );

    audio_client
        .stop_stream()
        .map_err(|e| AppError::Audio(format!("wasapi: stop_stream: {e}")))?;
    writer
        .finalize()
        .map_err(|e| AppError::Audio(e.to_string()))?;
    Ok(())
}
