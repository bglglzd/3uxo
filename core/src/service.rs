use crate::audio::wav_duration_secs;
use crate::error::{AppError, AppResult};
use crate::model::Meeting;
use crate::recorder::Recorder;
use crate::storage::Repo;
use crate::transcript::{merge_tracks, Transcript};
use crate::transcriber::Transcriber;
use std::path::{Path, PathBuf};

/// Активная запись: id и пути к дорожкам.
#[derive(Debug, Clone)]
pub struct ActiveRecording {
    pub id: String,
    pub mic_path: PathBuf,
    pub system_path: PathBuf,
}

/// Отклоняет id, который мог бы вырваться из каталога встреч (path traversal).
fn validate_id(id: &str) -> AppResult<()> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(AppError::InvalidInput(format!("invalid meeting id: {id}")));
    }
    Ok(())
}

fn meeting_dir(data_root: &Path, id: &str) -> PathBuf {
    data_root.join("meetings").join(id)
}

/// Начинает запись: создаёт папку встречи и стартует рекордер.
pub fn start_recording(
    recorder: &dyn Recorder,
    data_root: &Path,
    id: String,
) -> AppResult<ActiveRecording> {
    validate_id(&id)?;
    let dir = meeting_dir(data_root, &id);
    std::fs::create_dir_all(&dir)?;
    let mic_path = dir.join("mic.wav");
    let system_path = dir.join("system.wav");
    recorder.start(&mic_path, &system_path)?;
    Ok(ActiveRecording {
        id,
        mic_path,
        system_path,
    })
}

/// Останавливает запись, измеряет длительность и сохраняет встречу в БД.
pub fn stop_recording(
    recorder: &dyn Recorder,
    repo: &Repo,
    active: &ActiveRecording,
    created_at: String,
) -> AppResult<Meeting> {
    let result = recorder.stop()?;
    // Реальный рекордер может вернуть 0 — тогда измеряем по файлу и
    // пробрасываем ошибку, а не молча подставляем ноль.
    let duration_secs = if result.duration_secs > 0 {
        result.duration_secs
    } else {
        wav_duration_secs(&active.mic_path)?
    };
    let meeting = Meeting {
        id: active.id.clone(),
        created_at,
        title: "Новая встреча".into(),
        participants: String::new(),
        topic: String::new(),
        duration_secs,
        folder: active.id.clone(),
        status: "recorded".into(),
    };
    repo.insert(&meeting)?;
    Ok(meeting)
}

/// Удаляет встречу из БД и стирает её папку с диска.
pub fn delete_meeting(repo: &Repo, data_root: &Path, id: &str) -> AppResult<()> {
    validate_id(id)?;
    repo.delete(id)?;
    let dir = meeting_dir(data_root, id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    Ok(())
}

/// Абсолютный путь к файлу дорожки встречи (для проигрывания во фронтенде).
pub fn track_path(data_root: &Path, id: &str, track_file: &str) -> AppResult<PathBuf> {
    validate_id(id)?;
    let allowed = ["mic.wav", "system.wav"];
    if !allowed.contains(&track_file) {
        return Err(AppError::InvalidInput(format!(
            "unknown track file: {track_file}"
        )));
    }
    let path = meeting_dir(data_root, id).join(track_file);
    if !path.exists() {
        return Err(AppError::NotFound(track_file.to_string()));
    }
    Ok(path)
}

/// Тяжёлая часть расшифровки БЕЗ обращения к БД: читает дорожки,
/// прогоняет транскрайбер, пишет `transcript.json`. Вынесена отдельно,
/// чтобы вызывающий не держал блокировку БД во время долгой работы.
pub fn transcribe_to_file(
    transcriber: &dyn Transcriber,
    data_root: &Path,
    id: &str,
) -> AppResult<Transcript> {
    validate_id(id)?;
    let dir = meeting_dir(data_root, id);
    let mic = transcriber.transcribe(&dir.join("mic.wav"))?;
    let system = transcriber.transcribe(&dir.join("system.wav"))?;
    let transcript = merge_tracks(mic, system);
    let json = serde_json::to_string_pretty(&transcript)?;
    std::fs::write(dir.join("transcript.json"), json)?;
    Ok(transcript)
}

/// Расшифровывает обе дорожки встречи, сохраняет `transcript.json` и
/// ставит статус "transcribed".
pub fn transcribe_meeting(
    transcriber: &dyn Transcriber,
    repo: &Repo,
    data_root: &Path,
    id: &str,
) -> AppResult<Transcript> {
    let transcript = transcribe_to_file(transcriber, data_root, id)?;
    repo.update_status(id, "transcribed")?;
    Ok(transcript)
}

/// Читает сохранённую расшифровку встречи, если она есть.
pub fn load_transcript(data_root: &Path, id: &str) -> AppResult<Option<Transcript>> {
    validate_id(id)?;
    let path = meeting_dir(data_root, id).join("transcript.json");
    if !path.exists() {
        return Ok(None);
    }
    let data = std::fs::read_to_string(path)?;
    let transcript: Transcript = serde_json::from_str(&data)?;
    Ok(Some(transcript))
}

/// Сохраняет выжимку встречи в файл `summary.md`.
pub fn save_summary(data_root: &Path, id: &str, summary: &str) -> AppResult<()> {
    validate_id(id)?;
    let dir = meeting_dir(data_root, id);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("summary.md"), summary)?;
    Ok(())
}

/// Читает сохранённую выжимку, если есть.
pub fn load_summary(data_root: &Path, id: &str) -> AppResult<Option<String>> {
    validate_id(id)?;
    let path = meeting_dir(data_root, id).join("summary.md");
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(std::fs::read_to_string(path)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recorder::MockRecorder;
    use crate::transcriber::MockTranscriber;
    use crate::transcript::{Segment, Speaker};

    fn setup() -> (tempfile::TempDir, Repo, MockRecorder) {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repo::open_in_memory().unwrap();
        let rec = MockRecorder::new(2);
        (dir, repo, rec)
    }

    #[test]
    fn start_creates_folder_and_paths() {
        let (dir, _repo, rec) = setup();
        let active =
            start_recording(&rec, dir.path(), "m1".into()).unwrap();
        assert!(dir.path().join("meetings/m1").exists());
        assert!(active.mic_path.ends_with("mic.wav"));
        assert!(active.system_path.ends_with("system.wav"));
    }

    #[test]
    fn stop_saves_meeting_with_duration() {
        let (dir, repo, rec) = setup();
        let active = start_recording(&rec, dir.path(), "m1".into()).unwrap();
        let m = stop_recording(&rec, &repo, &active, "2026-06-04T10:00:00Z".into()).unwrap();
        assert_eq!(m.duration_secs, 2);
        assert_eq!(m.status, "recorded");
        assert_eq!(repo.get("m1").unwrap(), m);
    }

    #[test]
    fn delete_removes_db_row_and_folder() {
        let (dir, repo, rec) = setup();
        let active = start_recording(&rec, dir.path(), "m1".into()).unwrap();
        stop_recording(&rec, &repo, &active, "2026-06-04T10:00:00Z".into()).unwrap();
        delete_meeting(&repo, dir.path(), "m1").unwrap();
        assert!(repo.list().unwrap().is_empty());
        assert!(!dir.path().join("meetings/m1").exists());
    }

    #[test]
    fn track_path_rejects_unknown_file() {
        let (dir, _repo, _rec) = setup();
        assert!(matches!(
            track_path(dir.path(), "m1", "secrets.txt"),
            Err(AppError::InvalidInput(_))
        ));
    }

    #[test]
    fn rejects_path_traversal_id() {
        let (dir, repo, rec) = setup();
        assert!(matches!(
            start_recording(&rec, dir.path(), "../escape".into()),
            Err(AppError::InvalidInput(_))
        ));
        assert!(matches!(
            track_path(dir.path(), "../escape", "mic.wav"),
            Err(AppError::InvalidInput(_))
        ));
        assert!(matches!(
            delete_meeting(&repo, dir.path(), "../escape"),
            Err(AppError::InvalidInput(_))
        ));
    }

    #[test]
    fn track_path_returns_existing_file() {
        let (dir, repo, rec) = setup();
        let active = start_recording(&rec, dir.path(), "m1".into()).unwrap();
        stop_recording(&rec, &repo, &active, "2026-06-04T10:00:00Z".into()).unwrap();
        let p = track_path(dir.path(), "m1", "mic.wav").unwrap();
        assert!(p.exists());
    }

    fn seg(start: f64, text: &str) -> Segment {
        Segment { start_secs: start, end_secs: start + 1.0, text: text.into() }
    }

    #[test]
    fn load_transcript_none_before_transcription() {
        let (dir, repo, rec) = setup();
        let active = start_recording(&rec, dir.path(), "m1".into()).unwrap();
        stop_recording(&rec, &repo, &active, "2026-06-04T10:00:00Z".into()).unwrap();
        assert!(load_transcript(dir.path(), "m1").unwrap().is_none());
    }

    #[test]
    fn summary_save_and_load_roundtrip() {
        let (dir, _repo, _rec) = setup();
        assert!(load_summary(dir.path(), "m1").unwrap().is_none());
        save_summary(dir.path(), "m1", "## выжимка").unwrap();
        assert_eq!(load_summary(dir.path(), "m1").unwrap().unwrap(), "## выжимка");
    }

    #[test]
    fn transcribe_meeting_writes_and_sets_status() {
        let (dir, repo, rec) = setup();
        let active = start_recording(&rec, dir.path(), "m1".into()).unwrap();
        stop_recording(&rec, &repo, &active, "2026-06-04T10:00:00Z".into()).unwrap();

        let t = MockTranscriber::new(vec![seg(0.0, "привет")], vec![seg(1.0, "здравствуй")]);
        let transcript = transcribe_meeting(&t, &repo, dir.path(), "m1").unwrap();

        assert_eq!(transcript.segments.len(), 2);
        assert_eq!(transcript.segments[0].speaker, Speaker::Me);
        assert_eq!(transcript.segments[1].speaker, Speaker::Them);
        assert_eq!(repo.get("m1").unwrap().status, "transcribed");
        // и читается обратно
        let loaded = load_transcript(dir.path(), "m1").unwrap().unwrap();
        assert_eq!(loaded, transcript);
    }
}
