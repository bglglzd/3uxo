use crate::audio::{concat_wavs, wav_duration_secs};
use crate::error::{AppError, AppResult};
use crate::model::Meeting;
use crate::recorder::Recorder;
use crate::storage::Repo;
use crate::transcript::{merge_tracks, single_speaker, Transcript};
use crate::transcriber::Transcriber;
use std::path::{Path, PathBuf};

/// Активная запись: id, папка и сегменты дорожек.
///
/// Запись ведётся СЕГМЕНТАМИ: каждый непрерывный кусок пишется в
/// `mic.part{N}.wav` / `system.part{N}.wav`. Пауза финализирует текущий сегмент,
/// возобновление открывает следующий. На стопе все сегменты склеиваются в единый
/// `mic.wav`/`system.wav` (см. [`stop_recording`]). Такой подход не плодит мелкие
/// файлы и переживает аварийный обрыв: осиротевшие части склеит
/// [`recover_orphan_recordings`] при следующем запуске.
#[derive(Debug, Clone)]
pub struct ActiveRecording {
    pub id: String,
    pub dir: PathBuf,
    /// Уже финализированные сегменты: `(mic_part, system_part)`.
    pub segments: Vec<(PathBuf, PathBuf)>,
    /// Сегмент, который пишется прямо сейчас; `None` — запись на паузе.
    pub current: Option<(PathBuf, PathBuf)>,
}

/// Пути сегмента №`idx` в папке встречи.
fn segment_paths(dir: &Path, idx: usize) -> (PathBuf, PathBuf) {
    (
        dir.join(format!("mic.part{idx}.wav")),
        dir.join(format!("system.part{idx}.wav")),
    )
}

/// Собирает части одной дорожки в `dst` и удаляет части. Один сегмент —
/// мгновенное переименование (без перекодирования); несколько — склейка
/// [`concat_wavs`]. Пустой список — валидный WAV нулевой длины.
fn assemble_track(parts: &[PathBuf], dst: &Path) -> AppResult<()> {
    if parts.len() == 1 && std::fs::rename(&parts[0], dst).is_ok() {
        return Ok(());
    }
    concat_wavs(parts, dst)?;
    for p in parts {
        let _ = std::fs::remove_file(p);
    }
    Ok(())
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

/// Начинает запись: создаёт папку встречи и стартует первый сегмент.
pub fn start_recording(
    recorder: &dyn Recorder,
    data_root: &Path,
    id: String,
) -> AppResult<ActiveRecording> {
    validate_id(&id)?;
    let dir = meeting_dir(data_root, &id);
    std::fs::create_dir_all(&dir)?;
    let (mic_path, system_path) = segment_paths(&dir, 0);
    recorder.start(&mic_path, &system_path)?;
    Ok(ActiveRecording {
        id,
        dir,
        segments: Vec::new(),
        current: Some((mic_path, system_path)),
    })
}

/// Ставит запись на паузу: финализирует текущий сегмент. Если запись уже на
/// паузе — без изменений.
pub fn pause_recording(
    recorder: &dyn Recorder,
    mut active: ActiveRecording,
) -> AppResult<ActiveRecording> {
    if let Some(current) = active.current.take() {
        recorder.stop()?;
        active.segments.push(current);
    }
    Ok(active)
}

/// Возобновляет запись: открывает следующий сегмент. Если запись не на паузе —
/// без изменений.
pub fn resume_recording(
    recorder: &dyn Recorder,
    mut active: ActiveRecording,
) -> AppResult<ActiveRecording> {
    if active.current.is_none() {
        let (mic_path, system_path) = segment_paths(&active.dir, active.segments.len());
        recorder.start(&mic_path, &system_path)?;
        active.current = Some((mic_path, system_path));
    }
    Ok(active)
}

/// Останавливает запись, склеивает все сегменты в единые `mic.wav`/`system.wav`,
/// удаляет временные части, измеряет длительность и сохраняет встречу в БД.
pub fn stop_recording(
    recorder: &dyn Recorder,
    repo: &Repo,
    active: &ActiveRecording,
    created_at: String,
) -> AppResult<Meeting> {
    let mut segments = active.segments.clone();
    // Если запись шла (не на паузе) — финализируем текущий сегмент. Остановку
    // рекордера делаем best-effort: даже если поток захвата вернул ошибку, он
    // уже остановлен (флаг + join внутри stop), и встречу надо собрать и
    // сохранить — иначе кнопка «стоп» зависнет и запись потеряется.
    if let Some(current) = active.current.clone() {
        let _ = recorder.stop();
        segments.push(current);
    }

    let mic_final = active.dir.join("mic.wav");
    let system_final = active.dir.join("system.wav");
    let mic_parts: Vec<PathBuf> = segments.iter().map(|(m, _)| m.clone()).collect();
    let system_parts: Vec<PathBuf> = segments.iter().map(|(_, s)| s.clone()).collect();
    assemble_track(&mic_parts, &mic_final)?;
    assemble_track(&system_parts, &system_final)?;

    let duration_secs = wav_duration_secs(&mic_final)
        .unwrap_or(0)
        .max(wav_duration_secs(&system_final).unwrap_or(0));
    let meeting = Meeting {
        id: active.id.clone(),
        created_at,
        title: "Новая встреча".into(),
        participants: String::new(),
        topic: String::new(),
        duration_secs,
        folder: active.id.clone(),
        status: "recorded".into(),
        source: "recorded".into(),
    };
    repo.insert(&meeting)?;
    Ok(meeting)
}

/// Восстанавливает «осиротевшие» записи, оставшиеся после аварийного завершения
/// во время записи: в папках встреч ищет несклеенные сегменты
/// (`mic.part{N}.wav`/`system.part{N}.wav`), собирает их в единые
/// `mic.wav`/`system.wav`, удаляет части и добавляет встречу в БД, если её там
/// ещё нет. Слишком короткие огрызки (<1 с, не дошедшие до БД) удаляются целиком,
/// чтобы не плодить мусор. Возвращает число восстановленных встреч.
///
/// Запускается при старте приложения, когда активной записи заведомо нет —
/// поэтому любые части на диске действительно осиротевшие.
pub fn recover_orphan_recordings(
    repo: &Repo,
    data_root: &Path,
    created_at: String,
) -> AppResult<usize> {
    let meetings_dir = data_root.join("meetings");
    if !meetings_dir.exists() {
        return Ok(0);
    }
    let mut recovered = 0usize;
    for entry in std::fs::read_dir(&meetings_dir)? {
        let entry = entry?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let dir = entry.path();
        let id = match entry.file_name().into_string() {
            Ok(s) => s,
            Err(_) => continue,
        };
        let (mic_parts, system_parts) = collect_segment_parts(&dir);
        if mic_parts.is_empty() && system_parts.is_empty() {
            continue; // нет осиротевших частей — встреча завершилась штатно
        }

        let mic_final = dir.join("mic.wav");
        let system_final = dir.join("system.wav");
        assemble_track(&mic_parts, &mic_final)?;
        assemble_track(&system_parts, &system_final)?;

        let duration_secs = wav_duration_secs(&mic_final)
            .unwrap_or(0)
            .max(wav_duration_secs(&system_final).unwrap_or(0));
        let already_known = repo.get(&id).is_ok();
        if duration_secs == 0 && !already_known {
            // Пустой огрызок (краш сразу после старта) — выкидываем целиком.
            let _ = std::fs::remove_dir_all(&dir);
            continue;
        }
        if !already_known {
            let meeting = Meeting {
                id: id.clone(),
                created_at: created_at.clone(),
                title: "Восстановленная запись".into(),
                participants: String::new(),
                topic: String::new(),
                duration_secs,
                folder: id.clone(),
                status: "recorded".into(),
                source: "recorded".into(),
            };
            repo.insert(&meeting)?;
        }
        recovered += 1;
    }
    Ok(recovered)
}

/// Собирает части сегментов дорожек в папке встречи, отсортированные по номеру.
fn collect_segment_parts(dir: &Path) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut mic: Vec<(usize, PathBuf)> = Vec::new();
    let mut system: Vec<(usize, PathBuf)> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if let Some(idx) = parse_part_index(&name, "mic") {
                mic.push((idx, e.path()));
            } else if let Some(idx) = parse_part_index(&name, "system") {
                system.push((idx, e.path()));
            }
        }
    }
    mic.sort_by_key(|(i, _)| *i);
    system.sort_by_key(|(i, _)| *i);
    (
        mic.into_iter().map(|(_, p)| p).collect(),
        system.into_iter().map(|(_, p)| p).collect(),
    )
}

/// Номер сегмента из имени файла: `mic.part3.wav` + `"mic"` → `Some(3)`.
fn parse_part_index(name: &str, track: &str) -> Option<usize> {
    name.strip_prefix(track)?
        .strip_prefix(".part")?
        .strip_suffix(".wav")?
        .parse::<usize>()
        .ok()
}

/// Декодирует внешний аудиофайл (телефон/диктофон) в `audio.wav` (16 кГц
/// моно) и строит запись о встрече с `source = "imported"`, НЕ трогая БД —
/// тяжёлый декод можно гонять в фоне (`spawn_blocking`). Заголовок — из имени
/// исходного файла. Вставку в БД делает вызывающий (см. [`import_recording`]).
pub fn import_to_meeting(
    data_root: &Path,
    id: String,
    src: &Path,
    created_at: String,
) -> AppResult<Meeting> {
    validate_id(&id)?;
    let dir = meeting_dir(data_root, &id);
    std::fs::create_dir_all(&dir)?;
    let dst = dir.join("audio.wav");
    crate::decode::decode_to_wav_16k_mono(src, &dst)?;
    let duration_secs = wav_duration_secs(&dst)?;
    let title = src
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("Импортированная запись")
        .to_string();
    Ok(Meeting {
        id: id.clone(),
        created_at,
        title,
        participants: String::new(),
        topic: String::new(),
        duration_secs,
        folder: id,
        status: "recorded".into(),
        source: "imported".into(),
    })
}

/// Импортирует внешнюю аудиозапись как новую встречу: декодирует и сохраняет
/// её в БД. Удобно для тестов; в GUI декод и вставка разнесены (см. команду).
pub fn import_recording(
    repo: &Repo,
    data_root: &Path,
    id: String,
    src: &Path,
    created_at: String,
) -> AppResult<Meeting> {
    let meeting = import_to_meeting(data_root, id, src, created_at)?;
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
    let allowed = ["mic.wav", "system.wav", "audio.wav"];
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

/// Расшифровка ТОЛЬКО дорожки микрофона записанной встречи (соло-режим «я один»):
/// пишет `transcript.json`, всем сегментам один говорящий `me`. Дорожка
/// собеседника и диаризация пропускаются — это заметка на один голос.
pub fn transcribe_solo_to_file(
    transcriber: &dyn Transcriber,
    data_root: &Path,
    id: &str,
) -> AppResult<Transcript> {
    validate_id(id)?;
    let dir = meeting_dir(data_root, id);
    let segs = transcriber.transcribe(&dir.join("mic.wav"))?;
    let transcript = single_speaker(segs, crate::transcript::ME);
    let json = serde_json::to_string_pretty(&transcript)?;
    std::fs::write(dir.join("transcript.json"), json)?;
    Ok(transcript)
}

/// Расшифровка ОДНОЙ дорожки (`audio.wav`) импортированной встречи: пишет
/// `transcript.json`, всем сегментам один говорящий `spk0` (диаризация — M3).
pub fn transcribe_single_to_file(
    transcriber: &dyn Transcriber,
    data_root: &Path,
    id: &str,
) -> AppResult<Transcript> {
    validate_id(id)?;
    let dir = meeting_dir(data_root, id);
    let segs = transcriber.transcribe(&dir.join("audio.wav"))?;
    let transcript = crate::transcript::single_speaker(segs, "spk0");
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

/// Сохраняет уже готовую расшифровку в `transcript.json`.
pub fn save_transcript(data_root: &Path, id: &str, transcript: &Transcript) -> AppResult<()> {
    validate_id(id)?;
    let dir = meeting_dir(data_root, id);
    std::fs::create_dir_all(&dir)?;
    let json = serde_json::to_string_pretty(transcript)?;
    std::fs::write(dir.join("transcript.json"), json)?;
    Ok(())
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

/// Сохраняет литературный пересказ встречи в файл `literary.md`.
pub fn save_literary(data_root: &Path, id: &str, text: &str) -> AppResult<()> {
    validate_id(id)?;
    let dir = meeting_dir(data_root, id);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("literary.md"), text)?;
    Ok(())
}

/// Читает сохранённый литературный пересказ, если есть.
pub fn load_literary(data_root: &Path, id: &str) -> AppResult<Option<String>> {
    validate_id(id)?;
    let path = meeting_dir(data_root, id).join("literary.md");
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(std::fs::read_to_string(path)?))
}

/// Сохраняет краткое резюме встречи в `brief.md`.
pub fn save_brief(data_root: &Path, id: &str, text: &str) -> AppResult<()> {
    validate_id(id)?;
    let dir = meeting_dir(data_root, id);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("brief.md"), text)?;
    Ok(())
}

/// Читает сохранённое краткое резюме, если есть.
pub fn load_brief(data_root: &Path, id: &str) -> AppResult<Option<String>> {
    validate_id(id)?;
    let path = meeting_dir(data_root, id).join("brief.md");
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(std::fs::read_to_string(path)?))
}

/// Сохраняет ИИ-анализ встречи в `analysis.md`.
pub fn save_analysis(data_root: &Path, id: &str, text: &str) -> AppResult<()> {
    validate_id(id)?;
    let dir = meeting_dir(data_root, id);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("analysis.md"), text)?;
    Ok(())
}

/// Читает сохранённый ИИ-анализ, если есть.
pub fn load_analysis(data_root: &Path, id: &str) -> AppResult<Option<String>> {
    validate_id(id)?;
    let path = meeting_dir(data_root, id).join("analysis.md");
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
    use crate::transcript::Segment;

    fn setup() -> (tempfile::TempDir, Repo, MockRecorder) {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repo::open_in_memory().unwrap();
        let rec = MockRecorder::new(2);
        (dir, repo, rec)
    }

    #[test]
    fn start_creates_folder_and_first_segment() {
        let (dir, _repo, rec) = setup();
        let active =
            start_recording(&rec, dir.path(), "m1".into()).unwrap();
        assert!(dir.path().join("meetings/m1").exists());
        let (mic, system) = active.current.as_ref().unwrap();
        assert!(mic.ends_with("mic.part0.wav"));
        assert!(system.ends_with("system.part0.wav"));
        assert!(active.segments.is_empty());
    }

    #[test]
    fn pause_resume_merges_segments_into_single_file() {
        let (dir, repo, rec) = setup(); // MockRecorder пишет 2 с тишины на стоп
        let active = start_recording(&rec, dir.path(), "m1".into()).unwrap();
        let active = pause_recording(&rec, active).unwrap();
        assert_eq!(active.segments.len(), 1);
        assert!(active.current.is_none());
        let active = resume_recording(&rec, active).unwrap();
        assert!(active.current.is_some());
        let m = stop_recording(&rec, &repo, &active, "2026-06-04T10:00:00Z".into()).unwrap();
        // Два сегмента по 2 с → 4 с в едином файле; части удалены.
        assert_eq!(m.duration_secs, 4);
        assert!(dir.path().join("meetings/m1/mic.wav").exists());
        assert!(!dir.path().join("meetings/m1/mic.part0.wav").exists());
        assert!(!dir.path().join("meetings/m1/mic.part1.wav").exists());
    }

    /// Рекордер, который пишет дорожки, но возвращает ошибку из stop() —
    /// эмулирует сбой потока захвата (loopback/микрофон) в момент остановки.
    struct StopErrRecorder {
        inner: MockRecorder,
    }
    impl Recorder for StopErrRecorder {
        fn start(&self, mic: &std::path::Path, system: &std::path::Path) -> AppResult<()> {
            self.inner.start(mic, system)
        }
        fn stop(&self) -> AppResult<crate::recorder::RecordingResult> {
            // Внутренний мок пишет тишину в сегмент и чистит состояние; затем
            // имитируем ошибку остановки потока.
            let _ = self.inner.stop();
            Err(AppError::Audio("simulated stop failure".into()))
        }
        fn is_recording(&self) -> bool {
            self.inner.is_recording()
        }
    }

    #[test]
    fn stop_saves_meeting_even_if_recorder_stop_errors() {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repo::open_in_memory().unwrap();
        let rec = StopErrRecorder { inner: MockRecorder::new(2) };
        let active = start_recording(&rec, dir.path(), "m1".into()).unwrap();
        // Несмотря на ошибку recorder.stop(), встреча должна сохраниться.
        let m = stop_recording(&rec, &repo, &active, "2026-06-04T10:00:00Z".into()).unwrap();
        assert_eq!(m.duration_secs, 2);
        assert!(dir.path().join("meetings/m1/mic.wav").exists());
        assert_eq!(repo.get("m1").unwrap().id, "m1");
    }

    #[test]
    fn recover_orphan_concats_parts_and_inserts_meeting() {
        let (dir, repo, _rec) = setup();
        let mdir = dir.path().join("meetings/orphan");
        std::fs::create_dir_all(&mdir).unwrap();
        crate::audio::write_silence_wav(&mdir.join("mic.part0.wav"), 1).unwrap();
        crate::audio::write_silence_wav(&mdir.join("mic.part1.wav"), 1).unwrap();
        crate::audio::write_silence_wav(&mdir.join("system.part0.wav"), 1).unwrap();
        crate::audio::write_silence_wav(&mdir.join("system.part1.wav"), 1).unwrap();

        let n = recover_orphan_recordings(&repo, dir.path(), "2026-06-04T10:00:00Z".into()).unwrap();
        assert_eq!(n, 1);
        assert!(mdir.join("mic.wav").exists());
        assert!(!mdir.join("mic.part0.wav").exists());
        let m = repo.get("orphan").unwrap();
        assert_eq!(m.duration_secs, 2);
        assert_eq!(m.title, "Восстановленная запись");
    }

    #[test]
    fn recover_skips_finalized_meetings() {
        let (dir, repo, rec) = setup();
        let active = start_recording(&rec, dir.path(), "m1".into()).unwrap();
        stop_recording(&rec, &repo, &active, "2026-06-04T10:00:00Z".into()).unwrap();
        // После штатного стопа частей нет → восстанавливать нечего.
        let n = recover_orphan_recordings(&repo, dir.path(), "2026-06-04T11:00:00Z".into()).unwrap();
        assert_eq!(n, 0);
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
        assert_eq!(transcript.segments[0].speaker, "me");
        assert_eq!(transcript.segments[1].speaker, "them");
        assert_eq!(repo.get("m1").unwrap().status, "transcribed");
        // и читается обратно
        let loaded = load_transcript(dir.path(), "m1").unwrap().unwrap();
        assert_eq!(loaded, transcript);
    }

    #[test]
    fn import_recording_decodes_and_inserts() {
        let (dir, repo, _rec) = setup();
        // «Файл с телефона»: простой WAV (16 кГц моно), имя с пробелом.
        let src = dir.path().join("voice memo.wav");
        crate::audio::write_silence_wav(&src, 1).unwrap();

        let m = import_recording(
            &repo,
            dir.path(),
            "imp1".into(),
            &src,
            "2026-06-04T10:00:00Z".into(),
        )
        .unwrap();

        assert_eq!(m.source, "imported");
        assert_eq!(m.title, "voice memo");
        assert!(dir.path().join("meetings/imp1/audio.wav").exists());
        assert_eq!(repo.get("imp1").unwrap().source, "imported");
    }

    #[test]
    fn transcribe_solo_writes_me_only() {
        let (dir, repo, rec) = setup();
        let active = start_recording(&rec, dir.path(), "m1".into()).unwrap();
        stop_recording(&rec, &repo, &active, "2026-06-04T10:00:00Z".into()).unwrap();
        // mic → «моя заметка»; system-дорожка в соло игнорируется.
        let t = MockTranscriber::new(vec![seg(0.0, "моя заметка")], vec![seg(1.0, "шум")]);
        let transcript = transcribe_solo_to_file(&t, dir.path(), "m1").unwrap();
        assert_eq!(transcript.segments.len(), 1);
        assert!(transcript.segments.iter().all(|s| s.speaker == "me"));
    }

    #[test]
    fn transcribe_single_writes_one_speaker() {
        let (dir, repo, _rec) = setup();
        let src = dir.path().join("rec.wav");
        crate::audio::write_silence_wav(&src, 1).unwrap();
        import_recording(&repo, dir.path(), "imp2".into(), &src, "2026-06-04T10:00:00Z".into())
            .unwrap();

        // MockTranscriber для не-"mic.wav" (т.е. audio.wav) отдаёт system-сегменты.
        let t = MockTranscriber::new(vec![], vec![seg(0.0, "первая"), seg(1.0, "вторая")]);
        let transcript = transcribe_single_to_file(&t, dir.path(), "imp2").unwrap();

        assert_eq!(transcript.segments.len(), 2);
        assert!(transcript.segments.iter().all(|s| s.speaker == "spk0"));
    }
}
