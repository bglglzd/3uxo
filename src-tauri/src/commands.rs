use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use uxo_core::ai::{AiConfig, HttpChatBackend, MetadataSuggestion};
use uxo_core::cli_transcriber::{CliTranscriber, TranscribeOptions};
use uxo_core::error::{AppError, AppResult};
use uxo_core::model::Meeting;
use uxo_core::recorder::Recorder;
use uxo_core::service::{self, ActiveRecording};
use uxo_core::storage::Repo;
use uxo_core::transcript::Transcript;

/// Событие прогресса расшифровки для фронтенда.
#[derive(Clone, serde::Serialize)]
pub struct TranscribeProgress {
    pub id: String,
    /// "mic" (своя дорожка) или "system" (собеседник).
    pub stage: String,
    pub percent: i32,
}

/// Показывает нативное уведомление Windows (тихо игнорирует ошибки).
pub(crate) fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

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
    pub active: Mutex<Option<ActiveRecording>>,
}

#[tauri::command]
pub fn start_recording(app: AppHandle, state: tauri::State<AppState>) -> AppResult<String> {
    let mut active = state.active.lock().unwrap();
    if active.is_some() {
        return Err(AppError::InvalidState("already recording".into()));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let rec = service::start_recording(state.recorder.as_ref(), &state.data_root, id.clone())?;
    *active = Some(rec);
    notify(&app, "🔴 3uxo — запись начата", "Идёт запись звонка");
    Ok(id)
}

#[tauri::command]
pub async fn stop_recording(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<Meeting> {
    // Берём активную запись и сразу отпускаем lock, чтобы не держать его
    // во время блокирующего I/O в recorder.stop() (важно для Плана 2).
    let current = {
        let mut active = state.active.lock().unwrap();
        active
            .take()
            .ok_or_else(|| AppError::InvalidState("not recording".into()))?
    };
    let created_at = chrono::Utc::now().to_rfc3339();
    let meeting = {
        let repo = state.repo.lock().unwrap();
        service::stop_recording(state.recorder.as_ref(), &repo, &current, created_at)?
    };
    notify(&app, "✅ 3uxo — запись сохранена", &meeting.title);
    Ok(meeting)
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

// Асинхронная: тяжёлая работа (загрузка модели + whisper) уходит с главного
// потока, поэтому окно не зависает и можно ходить по другим встречам.
// Прогресс шлём событием `transcribe-progress`.
#[tauri::command]
pub async fn transcribe(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
    options: TranscribeOptions,
) -> AppResult<Transcript> {
    // Явно указанный внешний whisper-CLI — используем его (без прогресса).
    if options
        .whisper_path
        .as_deref()
        .map(|s| !s.is_empty())
        .unwrap_or(false)
    {
        let transcriber = CliTranscriber::new(options);
        let transcript = service::transcribe_to_file(&transcriber, &state.data_root, &id)?;
        state.repo.lock().unwrap().update_status(&id, "transcribed")?;
        notify(&app, "📝 3uxo — расшифровка готова", "Текст разговора готов");
        return Ok(transcript);
    }

    // Иначе — встроенный whisper.cpp; модель скачивается при первом запуске.
    #[cfg(feature = "whisper")]
    {
        use std::sync::Arc;
        use uxo_core::transcriber::Transcriber;
        use uxo_core::transcript::merge_tracks;
        use uxo_core::whisper::WhisperTranscriber;

        let mic_path = service::track_path(&state.data_root, &id, "mic.wav")?;
        let system_path = service::track_path(&state.data_root, &id, "system.wav")?;

        let progress_cb = |stage: &'static str| {
            let app = app.clone();
            let id = id.clone();
            Arc::new(move |percent: i32| {
                let _ = app.emit(
                    "transcribe-progress",
                    TranscribeProgress {
                        id: id.clone(),
                        stage: stage.into(),
                        percent,
                    },
                );
            })
        };

        // Дорожка «Я» (микрофон). Контекст модели создаётся и освобождается
        // до следующей дорожки, чтобы не держать две модели в памяти сразу.
        let mic_segs = {
            let t = WhisperTranscriber::managed(
                &state.data_root,
                options.model.as_deref(),
                options.language.clone(),
            )?
            .with_progress(progress_cb("mic"));
            t.transcribe(&mic_path)?
        };
        // Дорожка «Собеседник» (системный звук).
        let system_segs = {
            let t = WhisperTranscriber::managed(
                &state.data_root,
                options.model.as_deref(),
                options.language.clone(),
            )?
            .with_progress(progress_cb("system"));
            t.transcribe(&system_path)?
        };

        let transcript = merge_tracks(mic_segs, system_segs);
        service::save_transcript(&state.data_root, &id, &transcript)?;
        state.repo.lock().unwrap().update_status(&id, "transcribed")?;
        notify(&app, "📝 3uxo — расшифровка готова", "Текст разговора готов");
        Ok(transcript)
    }
    #[cfg(not(feature = "whisper"))]
    {
        let _ = (options, &app);
        Err(AppError::Audio(
            "встроенный Whisper недоступен в этой сборке; укажите путь к whisper в настройках".into(),
        ))
    }
}

#[tauri::command]
pub fn save_text_file(path: String, content: String) -> AppResult<()> {
    std::fs::write(&path, content)?;
    Ok(())
}

#[tauri::command]
pub fn get_transcript(state: tauri::State<AppState>, id: String) -> AppResult<Option<Transcript>> {
    service::load_transcript(&state.data_root, &id)
}

#[tauri::command]
pub async fn suggest_metadata(
    state: tauri::State<'_, AppState>,
    id: String,
    config: AiConfig,
) -> AppResult<MetadataSuggestion> {
    let text = meeting_transcript_text(&state.data_root, &id)?;
    let backend = HttpChatBackend::new(config);
    uxo_core::ai::suggest_metadata(&backend, &text)
}

#[tauri::command]
pub async fn summarize(
    state: tauri::State<'_, AppState>,
    id: String,
    config: AiConfig,
) -> AppResult<String> {
    let text = meeting_transcript_text(&state.data_root, &id)?;
    let backend = HttpChatBackend::new(config);
    // Длинные разговоры (2–3 ч) не влезают в контекст — map-reduce по частям.
    let summary = uxo_core::ai::summarize_long(&backend, &text)?;
    service::save_summary(&state.data_root, &id, &summary)?;
    state.repo.lock().unwrap().update_status(&id, "summarized")?;
    Ok(summary)
}

#[tauri::command]
pub fn get_summary(state: tauri::State<AppState>, id: String) -> AppResult<Option<String>> {
    service::load_summary(&state.data_root, &id)
}

#[tauri::command]
pub async fn ask(
    state: tauri::State<'_, AppState>,
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
