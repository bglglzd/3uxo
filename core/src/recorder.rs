use crate::audio::{wav_duration_secs, write_silence_wav};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// Результат остановки записи.
#[derive(Debug, Clone, PartialEq)]
pub struct RecordingResult {
    pub duration_secs: u64,
}

/// Текущий уровень (пик) каждой дорожки, нормализован 0..1000.
/// Для живых индикаторов записи; читается-и-сбрасывается при опросе.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct TrackLevels {
    pub mic: u32,
    pub system: u32,
}

/// Источник записи двух дорожек. В Плане 2 появится реализация на WASAPI.
pub trait Recorder: Send + Sync {
    /// Начать запись микрофона в `mic_path` и системного звука в `system_path`.
    fn start(&self, mic_path: &Path, system_path: &Path) -> AppResult<()>;
    /// Остановить и финализировать оба файла.
    fn stop(&self) -> AppResult<RecordingResult>;
    fn is_recording(&self) -> bool;
    /// Текущий уровень дорожек для индикаторов. Дефолт — нули (реализации,
    /// не умеющие мерить уровень, ничего не показывают).
    fn levels(&self) -> TrackLevels {
        TrackLevels::default()
    }
}

/// Мок-рекордер: вместо настоящего звука пишет тишину фиксированной длины.
pub struct MockRecorder {
    fixed_secs: u64,
    state: Mutex<Option<(std::path::PathBuf, std::path::PathBuf)>>,
    tick: AtomicU64,
}

impl MockRecorder {
    pub fn new(fixed_secs: u64) -> Self {
        Self {
            fixed_secs,
            state: Mutex::new(None),
            tick: AtomicU64::new(0),
        }
    }
}

impl Recorder for MockRecorder {
    fn start(&self, mic_path: &Path, system_path: &Path) -> AppResult<()> {
        let mut state = self.state.lock().unwrap();
        if state.is_some() {
            return Err(AppError::InvalidState("already recording".into()));
        }
        *state = Some((mic_path.to_path_buf(), system_path.to_path_buf()));
        Ok(())
    }

    fn stop(&self) -> AppResult<RecordingResult> {
        let mut state = self.state.lock().unwrap();
        let (mic, system) = state
            .take()
            .ok_or_else(|| AppError::InvalidState("not recording".into()))?;
        write_silence_wav(&mic, self.fixed_secs)?;
        write_silence_wav(&system, self.fixed_secs)?;
        let duration_secs = wav_duration_secs(&mic)?;
        Ok(RecordingResult { duration_secs })
    }

    fn is_recording(&self) -> bool {
        self.state.lock().unwrap().is_some()
    }

    fn levels(&self) -> TrackLevels {
        if self.state.lock().unwrap().is_none() {
            return TrackLevels::default();
        }
        // Две несинхронные синусоиды 0..1000 — «живые» тайлы без бэкенда WASAPI.
        let t = self.tick.fetch_add(1, Ordering::Relaxed) as f64;
        let mic = (((t * 0.30).sin() * 0.5 + 0.5) * 1000.0) as u32;
        let system = (((t * 0.21 + 1.0).sin() * 0.5 + 0.5) * 1000.0) as u32;
        TrackLevels { mic, system }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_cycle_writes_both_tracks() {
        let dir = tempfile::tempdir().unwrap();
        let mic = dir.path().join("mic.wav");
        let system = dir.path().join("system.wav");
        let rec = MockRecorder::new(2);

        assert!(!rec.is_recording());
        rec.start(&mic, &system).unwrap();
        assert!(rec.is_recording());

        let result = rec.stop().unwrap();
        assert!(!rec.is_recording());
        assert_eq!(result.duration_secs, 2);
        assert!(mic.exists() && system.exists());
    }

    #[test]
    fn double_start_is_invalid() {
        let dir = tempfile::tempdir().unwrap();
        let rec = MockRecorder::new(1);
        rec.start(&dir.path().join("a.wav"), &dir.path().join("b.wav"))
            .unwrap();
        let err = rec.start(&dir.path().join("c.wav"), &dir.path().join("d.wav"));
        assert!(matches!(err, Err(AppError::InvalidState(_))));
    }

    #[test]
    fn stop_without_start_is_invalid() {
        let rec = MockRecorder::new(1);
        assert!(matches!(rec.stop(), Err(AppError::InvalidState(_))));
    }

    #[test]
    fn mock_levels_zero_when_idle_and_alive_when_recording() {
        let dir = tempfile::tempdir().unwrap();
        let rec = MockRecorder::new(2);

        // В простое — нули.
        assert_eq!(rec.levels(), TrackLevels { mic: 0, system: 0 });

        rec.start(&dir.path().join("mic.wav"), &dir.path().join("sys.wav"))
            .unwrap();

        // Во время записи за несколько опросов должны появиться ненулевые уровни
        // на обеих дорожках, и все значения в диапазоне 0..=1000.
        let mut max_mic = 0;
        let mut max_sys = 0;
        for _ in 0..64 {
            let l = rec.levels();
            assert!(l.mic <= 1000 && l.system <= 1000);
            max_mic = max_mic.max(l.mic);
            max_sys = max_sys.max(l.system);
        }
        assert!(max_mic > 0, "mic level never rose");
        assert!(max_sys > 0, "system level never rose");

        rec.stop().unwrap();
        assert_eq!(rec.levels(), TrackLevels { mic: 0, system: 0 });
    }
}
