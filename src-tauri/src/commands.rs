use std::path::{Path, PathBuf};
use std::sync::Mutex;

use uxo_core::ai::{AiConfig, HttpChatBackend, MetadataSuggestion};
use uxo_core::error::{AppError, AppResult};
use uxo_core::model::Meeting;
use uxo_core::recorder::Recorder;
use uxo_core::service::{self, ActiveRecording};
use uxo_core::storage::Repo;
use uxo_core::transcriber::Transcriber;
use uxo_core::transcript::Transcript;

/// Текст расшифровки встречи для подачи в ИИ (ошибка, если ещё не расшифровано).
fn meeting_transcript_text(data_root: &Path, id: &str) -> AppResult<String> {
    let transcript = service::load_transcript(data_root, id)?.ok_or_else(|| {
        AppError::InvalidState("нет расшифровки — сначала расшифруйте встречу".into())
    })?;
    Ok(uxo_core::ai::transcript_to_text(&transcript))
}

/// Глобальное состояние приложения.
pub struct AppState {
    pub data_root: PathBuf,
    pub repo: Mutex<Repo>,
    pub recorder: Box<dyn Recorder>,
    pub transcriber: Box<dyn Transcriber>,
    pub active: Mutex<Option<ActiveRecording>>,
}

#[tauri::command]
pub fn start_recording(state: tauri::State<AppState>) -> AppResult<String> {
    let mut active = state.active.lock().unwrap();
    if active.is_some() {
        return Err(AppError::InvalidState("already recording".into()));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let rec = service::start_recording(state.recorder.as_ref(), &state.data_root, id.clone())?;
    *active = Some(rec);
    Ok(id)
}

#[tauri::command]
pub fn stop_recording(state: tauri::State<AppState>) -> AppResult<Meeting> {
    // Берём активную запись и сразу отпускаем lock, чтобы не держать его
    // во время блокирующего I/O в recorder.stop() (важно для Плана 2).
    let current = {
        let mut active = state.active.lock().unwrap();
        active
            .take()
            .ok_or_else(|| AppError::InvalidState("not recording".into()))?
    };
    let created_at = chrono::Utc::now().to_rfc3339();
    let repo = state.repo.lock().unwrap();
    service::stop_recording(state.recorder.as_ref(), &repo, &current, created_at)
}

#[tauri::command]
pub fn list_meetings(state: tauri::State<AppState>) -> AppResult<Vec<Meeting>> {
    state.repo.lock().unwrap().list()
}

#[tauri::command]
pub fn get_meeting(state: tauri::State<AppState>, id: String) -> AppResult<Meeting> {
    state.repo.lock().unwrap().get(&id)
}

#[tauri::command]
pub fn delete_meeting(state: tauri::State<AppState>, id: String) -> AppResult<()> {
    let repo = state.repo.lock().unwrap();
    service::delete_meeting(&repo, &state.data_root, &id)
}

/// Абсолютный путь к дорожке — фронтенд превратит его в asset-URL.
#[tauri::command]
pub fn track_path(
    state: tauri::State<AppState>,
    id: String,
    track_file: String,
) -> AppResult<String> {
    let p = service::track_path(&state.data_root, &id, &track_file)?;
    Ok(p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn is_recording(state: tauri::State<AppState>) -> bool {
    state.active.lock().unwrap().is_some()
}

/// Переключает запись (для горячей клавиши и трея). Возвращает `true`, если
/// запись только что началась, `false` — если остановлена.
pub fn toggle_recording_state(state: &AppState) -> AppResult<bool> {
    let was_recording = state.active.lock().unwrap().is_some();
    if was_recording {
        let current = state.active.lock().unwrap().take();
        if let Some(current) = current {
            let created_at = chrono::Utc::now().to_rfc3339();
            let repo = state.repo.lock().unwrap();
            service::stop_recording(state.recorder.as_ref(), &repo, &current, created_at)?;
        }
        Ok(false)
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        let rec = service::start_recording(state.recorder.as_ref(), &state.data_root, id)?;
        *state.active.lock().unwrap() = Some(rec);
        Ok(true)
    }
}

#[tauri::command]
pub fn transcribe(state: tauri::State<AppState>, id: String) -> AppResult<Transcript> {
    let repo = state.repo.lock().unwrap();
    service::transcribe_meeting(state.transcriber.as_ref(), &repo, &state.data_root, &id)
}

#[tauri::command]
pub fn get_transcript(state: tauri::State<AppState>, id: String) -> AppResult<Option<Transcript>> {
    service::load_transcript(&state.data_root, &id)
}

#[tauri::command]
pub fn suggest_metadata(
    state: tauri::State<AppState>,
    id: String,
    config: AiConfig,
) -> AppResult<MetadataSuggestion> {
    let text = meeting_transcript_text(&state.data_root, &id)?;
    let backend = HttpChatBackend::new(config);
    uxo_core::ai::suggest_metadata(&backend, &text)
}

#[tauri::command]
pub fn summarize(state: tauri::State<AppState>, id: String, config: AiConfig) -> AppResult<String> {
    let text = meeting_transcript_text(&state.data_root, &id)?;
    let backend = HttpChatBackend::new(config);
    let summary = uxo_core::ai::summarize(&backend, &text)?;
    service::save_summary(&state.data_root, &id, &summary)?;
    state.repo.lock().unwrap().update_status(&id, "summarized")?;
    Ok(summary)
}

#[tauri::command]
pub fn get_summary(state: tauri::State<AppState>, id: String) -> AppResult<Option<String>> {
    service::load_summary(&state.data_root, &id)
}

#[tauri::command]
pub fn ask(
    state: tauri::State<AppState>,
    id: String,
    config: AiConfig,
    question: String,
) -> AppResult<String> {
    let text = meeting_transcript_text(&state.data_root, &id)?;
    let backend = HttpChatBackend::new(config);
    uxo_core::ai::answer_question(&backend, &text, &question)
}

#[tauri::command]
pub fn update_meeting_meta(
    state: tauri::State<AppState>,
    id: String,
    title: String,
    participants: String,
    topic: String,
) -> AppResult<()> {
    state
        .repo
        .lock()
        .unwrap()
        .update_meta(&id, &title, &participants, &topic)
}
