use crate::audio::{wav_duration_secs, write_silence_wav};
use crate::error::{AppError, AppResult};
use std::path::Path;
use std::sync::Mutex;

/// Результат остановки записи.
#[derive(Debug, Clone, PartialEq)]
pub struct RecordingResult {
    pub duration_secs: u64,
}

/// Источник записи двух дорожек. В Плане 2 появится реализация на WASAPI.
pub trait Recorder: Send + Sync {
    /// Начать запись микрофона в `mic_path` и системного звука в `system_path`.
    fn start(&self, mic_path: &Path, system_path: &Path) -> AppResult<()>;
    /// Остановить и финализировать оба файла.
    fn stop(&self) -> AppResult<RecordingResult>;
    fn is_recording(&self) -> bool;
}

/// Мок-рекордер: вместо настоящего звука пишет тишину фиксированной длины.
pub struct MockRecorder {
    fixed_secs: u64,
    state: Mutex<Option<(std::path::PathBuf, std::path::PathBuf)>>,
}

impl MockRecorder {
    pub fn new(fixed_secs: u64) -> Self {
        Self {
            fixed_secs,
            state: Mutex::new(None),
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
}
