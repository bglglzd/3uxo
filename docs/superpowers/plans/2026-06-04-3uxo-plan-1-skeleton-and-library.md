# 3uxo — План 1: Каркас, модель данных и библиотека встреч

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Рабочее Tauri-приложение, которое умеет «записать» встречу (через мок-рекордер за интерфейсом `Recorder`), сохранить её в SQLite + файлы, показать в списке встреч и проиграть аудио.

**Architecture:** Ядро на Rust (`src-tauri`) с чёткими слоями: модель данных → хранилище (rusqlite) → интерфейс `Recorder` + мок → сервис-функции → тонкие Tauri-команды. Интерфейс на React/TypeScript (Vite). Вся бизнес-логика тестируется через `cargo test` и `vitest` без запуска GUI и без аудио-железа.

**Tech Stack:** Tauri 2, Rust (rusqlite, serde, uuid, chrono, hound, thiserror, tempfile), React 18 + TypeScript + Vite, vitest + @testing-library/react.

**Важно об окружении:** настоящий захват звука делается в Плане 2 на Windows. В этом плане звук «эмулируется» мок-рекордером, поэтому всё собирается и проверяется на любой ОС, включая Linux-сервер разработки.

> **ADDENDUM (во время исполнения).** Крейт `tauri` требует системных
> библиотек GTK/WebKit2GTK, которых нет на Linux-сервере разработки и которые
> нельзя поставить без root. Чтобы доменная логика собиралась и тестировалась
> здесь по-настоящему (без фейковых костылей), проект превращён в **Cargo
> workspace** из двух крейтов:
>
> - **`core/` (крейт `uxo-core`)** — вся логика без GUI: `error`, `model`,
>   `audio`, `storage`, `recorder`, `service`. Зависимости: rusqlite, serde,
>   serde_json, uuid, chrono, hound, thiserror (+ tempfile в dev). НЕ зависит
>   от tauri. Модули объявлены `pub mod ...;` в `core/src/lib.rs`. Тесты:
>   `cargo test -p uxo-core` (работает на Linux без GTK).
> - **`src-tauri/` (крейт `app-3uxo`)** — тонкий слой: `commands.rs` + сборка
>   приложения в `lib.rs`. Зависит от `uxo-core`, tauri, serde, serde_json,
>   uuid, chrono. Собирается на Windows/macOS или на Linux с GTK.
>
> Поэтому ниже: модули Задач 1–6 фактически лежат в `core/src/` (а не
> `src-tauri/src/`), внутри них пути `crate::...` корректны как есть; команды
> Задачи 7 обращаются к логике как `uxo_core::model::Meeting`,
> `uxo_core::service`, `uxo_core::error::AppError` и т.д. Корневой `Cargo.toml`
> — виртуальный workspace с `members = ["core", "src-tauri"]`.

---

## Структура файлов (создаётся этим планом)

```
3uxo/
├─ src-tauri/
│  ├─ Cargo.toml                  # зависимости Rust
│  ├─ tauri.conf.json             # конфиг Tauri (+ assetProtocol scope)
│  ├─ build.rs                    # сгенерирован create-tauri-app
│  └─ src/
│     ├─ main.rs                  # точка входа, запускает lib
│     ├─ lib.rs                   # сборка App, регистрация команд и состояния
│     ├─ error.rs                 # тип ошибки AppError
│     ├─ model.rs                 # struct Meeting, RecordingTrack
│     ├─ storage.rs              # Repo: SQLite-хранилище встреч
│     ├─ audio.rs                 # write_silence_wav, wav_duration_secs
│     ├─ recorder.rs              # trait Recorder + MockRecorder
│     ├─ service.rs               # бизнес-логика (тестируемая, без Tauri)
│     └─ commands.rs              # тонкие #[tauri::command] обёртки
├─ src/                           # фронтенд (React)
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ api.ts                      # обёртка над invoke/convertFileSrc
│  ├─ types.ts                    # тип Meeting (зеркало Rust)
│  ├─ components/
│  │  ├─ RecordButton.tsx
│  │  ├─ MeetingList.tsx
│  │  └─ MeetingDetail.tsx
│  └─ test/
│     ├─ setup.ts
│     ├─ RecordButton.test.tsx
│     ├─ MeetingList.test.tsx
│     └─ MeetingDetail.test.tsx
├─ vitest.config.ts
├─ package.json
└─ README.md
```

Принцип разделения: каждый модуль Rust имеет одну ответственность. `service.rs`
содержит логику команд в виде обычных функций (принимают `&Repo` и `&dyn Recorder`),
а `commands.rs` — только тонкие обёртки, достающие состояние из Tauri. Так логика
тестируется без запуска приложения.

---

## Task 0: Скаффолдинг проекта

**Files:**
- Create: весь каркас через `create-tauri-app`

- [ ] **Step 1: Проверить наличие инструментов**

Run:
```bash
node --version && npm --version && cargo --version && rustc --version
```
Expected: версии печатаются без ошибок. Если `cargo` нет — установить Rust через rustup.

- [ ] **Step 2: Сгенерировать проект Tauri 2 + React + TS прямо в текущей папке**

Папка `3uxo` уже существует и содержит `docs/`. Скаффолдим во временную папку и переносим, чтобы не затереть `docs/` и `.git`.

Run:
```bash
cd <workspace> && npm create tauri-app@latest 3uxo-scaffold -- --template react-ts --manager npm --yes
```
Expected: создана папка `3uxo-scaffold` с `src/`, `src-tauri/`, `package.json`.

- [ ] **Step 3: Перенести содержимое скаффолда в проект, сохранив docs/ и git**

Run:
```bash
cd <project-root>-scaffold && \
cp -rn src src-tauri package.json package-lock.json index.html vite.config.ts tsconfig*.json public <project-root>/ 2>/dev/null; \
cd <workspace> && rm -rf 3uxo-scaffold && echo moved
```
Expected: в `<project-root>` появились `src/`, `src-tauri/`, `package.json` и т.д.

- [ ] **Step 4: Установить зависимости фронтенда**

Run:
```bash
cd <project-root> && npm install
```
Expected: создаётся `node_modules`, без ошибок.

- [ ] **Step 5: Закоммитить чистый скаффолд**

```bash
cd <project-root> && git add -A && git commit -m "chore: scaffold Tauri 2 + React + TS app"
```

---

## Task 1: Зависимости Rust и модуль ошибок

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/error.rs`

- [ ] **Step 1: Добавить зависимости в `src-tauri/Cargo.toml`**

В секцию `[dependencies]` добавить (не трогая уже существующие `tauri`, `serde`, `serde_json`):

```toml
rusqlite = { version = "0.31", features = ["bundled"] }
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
hound = "3"
thiserror = "1"

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Создать `src-tauri/src/error.rs`**

```rust
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("audio error: {0}")]
    Audio(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid state: {0}")]
    InvalidState(String),
}

// Чтобы ошибку можно было вернуть из Tauri-команды во фронтенд.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
```

- [ ] **Step 3: Подключить модуль в `src-tauri/src/lib.rs`**

В начало `lib.rs` добавить строку (рядом с существующим кодом):

```rust
mod error;
```

- [ ] **Step 4: Проверить сборку**

Run:
```bash
cd <project-root>/src-tauri && cargo build
```
Expected: компилируется (могут быть warnings про неиспользуемый код — это нормально).

- [ ] **Step 5: Commit**

```bash
cd <project-root> && git add -A && git commit -m "feat: add Rust deps and AppError type"
```

---

## Task 2: Модель данных

**Files:**
- Create: `src-tauri/src/model.rs`

- [ ] **Step 1: Написать падающий тест сериализации**

Создать `src-tauri/src/model.rs`:

```rust
use serde::{Deserialize, Serialize};

/// Дорожка записи: микрофон (это «Я») или системный звук (это «Собеседник»).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RecordingTrack {
    Mic,
    System,
}

/// Одна записанная встреча.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Meeting {
    pub id: String,
    /// ISO-8601, UTC.
    pub created_at: String,
    pub title: String,
    pub participants: String,
    pub topic: String,
    pub duration_secs: u64,
    /// Имя папки встречи внутри каталога данных.
    pub folder: String,
    /// recorded | transcribed | summarized (в Плане 1 всегда "recorded").
    pub status: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn meeting_round_trips_through_json() {
        let m = Meeting {
            id: "abc".into(),
            created_at: "2026-06-04T10:00:00Z".into(),
            title: "Звонок".into(),
            participants: "Иван".into(),
            topic: "Планы".into(),
            duration_secs: 42,
            folder: "abc".into(),
            status: "recorded".into(),
        };
        let json = serde_json::to_string(&m).unwrap();
        let back: Meeting = serde_json::from_str(&json).unwrap();
        assert_eq!(m, back);
    }

    #[test]
    fn track_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&RecordingTrack::Mic).unwrap(), "\"mic\"");
        assert_eq!(
            serde_json::to_string(&RecordingTrack::System).unwrap(),
            "\"system\""
        );
    }
}
```

- [ ] **Step 2: Подключить модуль**

В `src-tauri/src/lib.rs` добавить `mod model;`.

- [ ] **Step 3: Запустить тесты — должны падать или сразу пройти**

Run:
```bash
cd <project-root>/src-tauri && cargo test model::
```
Expected: PASS (модель самодостаточна). Если не компилируется — исправить опечатки.

- [ ] **Step 4: Commit**

```bash
cd <project-root> && git add -A && git commit -m "feat: add Meeting model"
```

---

## Task 3: Аудио-помощник (генерация и измерение WAV)

**Files:**
- Create: `src-tauri/src/audio.rs`

- [ ] **Step 1: Написать падающий тест**

Создать `src-tauri/src/audio.rs`:

```rust
use crate::error::{AppError, AppResult};
use std::path::Path;

const SAMPLE_RATE: u32 = 16_000;

/// Записывает `secs` секунд тишины в WAV-файл (моно, 16 кГц, 16 бит).
/// Используется мок-рекордером, чтобы у встречи был проигрываемый файл.
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

/// Возвращает длительность WAV-файла в секундах (округление вниз).
pub fn wav_duration_secs(path: &Path) -> AppResult<u64> {
    let reader = hound::WavReader::open(path).map_err(|e| AppError::Audio(e.to_string()))?;
    let spec = reader.spec();
    let frames = reader.len() as u64 / spec.channels as u64;
    Ok(frames / spec.sample_rate as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_measures_three_seconds() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.wav");
        write_silence_wav(&path, 3).unwrap();
        assert!(path.exists());
        assert_eq!(wav_duration_secs(&path).unwrap(), 3);
    }
}
```

- [ ] **Step 2: Подключить модуль** — в `lib.rs` добавить `mod audio;`.

- [ ] **Step 3: Запустить тест**

Run:
```bash
cd <project-root>/src-tauri && cargo test audio::
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd <project-root> && git add -A && git commit -m "feat: add WAV silence/duration helpers"
```

---

## Task 4: Хранилище (SQLite-репозиторий)

**Files:**
- Create: `src-tauri/src/storage.rs`

- [ ] **Step 1: Написать падающие тесты**

Создать `src-tauri/src/storage.rs`:

```rust
use crate::error::{AppError, AppResult};
use crate::model::Meeting;
use rusqlite::{params, Connection};

/// Хранилище встреч поверх SQLite.
pub struct Repo {
    conn: Connection,
}

impl Repo {
    /// Открывает БД по пути к файлу и создаёт схему при необходимости.
    pub fn open(db_path: &std::path::Path) -> AppResult<Self> {
        let conn = Connection::open(db_path)?;
        Self::init(conn)
    }

    /// БД в памяти — для тестов.
    pub fn open_in_memory() -> AppResult<Self> {
        let conn = Connection::open_in_memory()?;
        Self::init(conn)
    }

    fn init(conn: Connection) -> AppResult<Self> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS meetings (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                title TEXT NOT NULL,
                participants TEXT NOT NULL,
                topic TEXT NOT NULL,
                duration_secs INTEGER NOT NULL,
                folder TEXT NOT NULL,
                status TEXT NOT NULL
            )",
            [],
        )?;
        Ok(Self { conn })
    }

    pub fn insert(&self, m: &Meeting) -> AppResult<()> {
        self.conn.execute(
            "INSERT INTO meetings
                (id, created_at, title, participants, topic, duration_secs, folder, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                m.id,
                m.created_at,
                m.title,
                m.participants,
                m.topic,
                m.duration_secs,
                m.folder,
                m.status
            ],
        )?;
        Ok(())
    }

    /// Все встречи, новейшие сверху.
    pub fn list(&self) -> AppResult<Vec<Meeting>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, created_at, title, participants, topic, duration_secs, folder, status
             FROM meetings ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], Self::row_to_meeting)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn get(&self, id: &str) -> AppResult<Meeting> {
        let mut stmt = self.conn.prepare(
            "SELECT id, created_at, title, participants, topic, duration_secs, folder, status
             FROM meetings WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], Self::row_to_meeting)?;
        match rows.next() {
            Some(r) => Ok(r?),
            None => Err(AppError::NotFound(id.to_string())),
        }
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let n = self
            .conn
            .execute("DELETE FROM meetings WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(AppError::NotFound(id.to_string()));
        }
        Ok(())
    }

    fn row_to_meeting(row: &rusqlite::Row) -> rusqlite::Result<Meeting> {
        Ok(Meeting {
            id: row.get(0)?,
            created_at: row.get(1)?,
            title: row.get(2)?,
            participants: row.get(3)?,
            topic: row.get(4)?,
            duration_secs: row.get::<_, i64>(5)? as u64,
            folder: row.get(6)?,
            status: row.get(7)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, created_at: &str) -> Meeting {
        Meeting {
            id: id.into(),
            created_at: created_at.into(),
            title: "t".into(),
            participants: "p".into(),
            topic: "x".into(),
            duration_secs: 10,
            folder: id.into(),
            status: "recorded".into(),
        }
    }

    #[test]
    fn insert_then_get_returns_same() {
        let repo = Repo::open_in_memory().unwrap();
        let m = sample("a", "2026-06-04T10:00:00Z");
        repo.insert(&m).unwrap();
        assert_eq!(repo.get("a").unwrap(), m);
    }

    #[test]
    fn list_orders_newest_first() {
        let repo = Repo::open_in_memory().unwrap();
        repo.insert(&sample("old", "2026-06-01T10:00:00Z")).unwrap();
        repo.insert(&sample("new", "2026-06-04T10:00:00Z")).unwrap();
        let ids: Vec<String> = repo.list().unwrap().into_iter().map(|m| m.id).collect();
        assert_eq!(ids, vec!["new", "old"]);
    }

    #[test]
    fn get_missing_is_not_found() {
        let repo = Repo::open_in_memory().unwrap();
        assert!(matches!(repo.get("nope"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn delete_removes_row() {
        let repo = Repo::open_in_memory().unwrap();
        repo.insert(&sample("a", "2026-06-04T10:00:00Z")).unwrap();
        repo.delete("a").unwrap();
        assert!(repo.list().unwrap().is_empty());
    }
}
```

- [ ] **Step 2: Подключить модуль** — в `lib.rs` добавить `mod storage;`.

- [ ] **Step 3: Запустить тесты**

Run:
```bash
cd <project-root>/src-tauri && cargo test storage::
```
Expected: 4 теста PASS.

- [ ] **Step 4: Commit**

```bash
cd <project-root> && git add -A && git commit -m "feat: add SQLite meeting repository"
```

---

## Task 5: Интерфейс Recorder и мок-реализация

**Files:**
- Create: `src-tauri/src/recorder.rs`

- [ ] **Step 1: Написать падающие тесты**

Создать `src-tauri/src/recorder.rs`:

```rust
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
/// Позволяет собрать и протестировать весь конвейер без аудио-железа.
pub struct MockRecorder {
    /// Сколько секунд «тишины» писать при остановке.
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
```

- [ ] **Step 2: Подключить модуль** — в `lib.rs` добавить `mod recorder;`.

- [ ] **Step 3: Запустить тесты**

Run:
```bash
cd <project-root>/src-tauri && cargo test recorder::
```
Expected: 3 теста PASS.

- [ ] **Step 4: Commit**

```bash
cd <project-root> && git add -A && git commit -m "feat: add Recorder trait and MockRecorder"
```

---

## Task 6: Сервис-слой (тестируемая бизнес-логика)

**Files:**
- Create: `src-tauri/src/service.rs`

Сервис не зависит от Tauri: принимает `&Repo`, `&dyn Recorder` и корневой каталог
данных. Это позволяет покрыть тестами всю логику «начать/остановить/список/удалить».

- [ ] **Step 1: Написать падающие тесты**

Создать `src-tauri/src/service.rs`:

```rust
use crate::audio::wav_duration_secs;
use crate::error::{AppError, AppResult};
use crate::model::Meeting;
use crate::recorder::Recorder;
use crate::storage::Repo;
use std::path::{Path, PathBuf};

/// Активная запись: id и пути к дорожкам.
#[derive(Debug, Clone)]
pub struct ActiveRecording {
    pub id: String,
    pub mic_path: PathBuf,
    pub system_path: PathBuf,
}

fn meeting_dir(data_root: &Path, id: &str) -> PathBuf {
    data_root.join("meetings").join(id)
}

/// Начинает запись: создаёт папку встречи и стартует рекордер.
/// Возвращает данные активной записи (хранятся в состоянии приложения).
pub fn start_recording(
    recorder: &dyn Recorder,
    data_root: &Path,
    id: String,
) -> AppResult<ActiveRecording> {
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
    let duration_secs = if result.duration_secs > 0 {
        result.duration_secs
    } else {
        wav_duration_secs(&active.mic_path).unwrap_or(0)
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
    repo.delete(id)?;
    let dir = meeting_dir(data_root, id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    Ok(())
}

/// Абсолютный путь к файлу дорожки встречи (для проигрывания во фронтенде).
pub fn track_path(data_root: &Path, id: &str, track_file: &str) -> AppResult<PathBuf> {
    let allowed = ["mic.wav", "system.wav"];
    if !allowed.contains(&track_file) {
        return Err(AppError::NotFound(track_file.to_string()));
    }
    let path = meeting_dir(data_root, id).join(track_file);
    if !path.exists() {
        return Err(AppError::NotFound(track_file.to_string()));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recorder::MockRecorder;

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
        assert!(track_path(dir.path(), "m1", "secrets.txt").is_err());
    }

    #[test]
    fn track_path_returns_existing_file() {
        let (dir, repo, rec) = setup();
        let active = start_recording(&rec, dir.path(), "m1".into()).unwrap();
        stop_recording(&rec, &repo, &active, "2026-06-04T10:00:00Z".into()).unwrap();
        let p = track_path(dir.path(), "m1", "mic.wav").unwrap();
        assert!(p.exists());
    }
}
```

- [ ] **Step 2: Подключить модуль** — в `lib.rs` добавить `mod service;`.

- [ ] **Step 3: Запустить тесты**

Run:
```bash
cd <project-root>/src-tauri && cargo test service::
```
Expected: 5 тестов PASS.

- [ ] **Step 4: Commit**

```bash
cd <project-root> && git add -A && git commit -m "feat: add service layer with full test coverage"
```

---

## Task 7: Tauri-команды и состояние приложения

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Создать `src-tauri/src/commands.rs`**

```rust
use crate::error::{AppError, AppResult};
use crate::model::Meeting;
use crate::recorder::Recorder;
use crate::service::{self, ActiveRecording};
use crate::storage::Repo;
use std::path::PathBuf;
use std::sync::Mutex;

/// Глобальное состояние приложения.
pub struct AppState {
    pub data_root: PathBuf,
    pub repo: Mutex<Repo>,
    pub recorder: Box<dyn Recorder>,
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
    let mut active = state.active.lock().unwrap();
    let current = active
        .take()
        .ok_or_else(|| AppError::InvalidState("not recording".into()))?;
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
```

- [ ] **Step 2: Переписать `src-tauri/src/lib.rs`**

Заменить содержимое (сохранив все `mod ...;`) на:

```rust
mod audio;
mod commands;
mod error;
mod model;
mod recorder;
mod service;
mod storage;

use commands::AppState;
use recorder::MockRecorder;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::Manager;
            let data_root = app
                .path()
                .app_data_dir()
                .expect("no app data dir");
            std::fs::create_dir_all(&data_root).expect("cannot create data dir");
            let db_path = data_root.join("3uxo.db");
            let repo = storage::Repo::open(&db_path).expect("cannot open db");

            app.manage(AppState {
                data_root,
                repo: Mutex::new(repo),
                // В Плане 1 — мок на 5 секунд. В Плане 2 заменим на WasapiRecorder.
                recorder: Box::new(MockRecorder::new(5)),
                active: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_recording,
            commands::stop_recording,
            commands::list_meetings,
            commands::get_meeting,
            commands::delete_meeting,
            commands::track_path,
            commands::is_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

> Примечание: `tauri_plugin_opener` обычно уже подключён скаффолдом. Если в исходном
> `lib.rs` его не было — убрать строку `.plugin(tauri_plugin_opener::init())`.

- [ ] **Step 3: Включить asset-протокол в `src-tauri/tauri.conf.json`**

В объекте `app` добавить (или дополнить) секцию `security`:

```json
"security": {
  "assetProtocol": {
    "enable": true,
    "scope": ["$APPDATA/**", "$APPDATA/../**"]
  }
}
```

> Это разрешает фронтенду читать WAV-файлы из каталога данных через `convertFileSrc`.
> Точный scope под платформу проверяется при ручном smoke-тесте; при необходимости
> расширить до `"**"` на время разработки.

- [ ] **Step 4: Проверить сборку ядра**

Run:
```bash
cd <project-root>/src-tauri && cargo build && cargo test
```
Expected: всё компилируется, все тесты предыдущих задач PASS.

- [ ] **Step 5: Commit**

```bash
cd <project-root> && git add -A && git commit -m "feat: wire Tauri commands and app state"
```

---

## Task 8: Фронтенд — типы и API-обёртка

**Files:**
- Create: `src/types.ts`
- Create: `src/api.ts`

- [ ] **Step 1: Создать `src/types.ts`**

```ts
export interface Meeting {
  id: string;
  created_at: string;
  title: string;
  participants: string;
  topic: string;
  duration_secs: number;
  folder: string;
  status: string;
}

export type TrackFile = "mic.wav" | "system.wav";
```

- [ ] **Step 2: Создать `src/api.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Meeting, TrackFile } from "./types";

export const api = {
  startRecording: (): Promise<string> => invoke("start_recording"),
  stopRecording: (): Promise<Meeting> => invoke("stop_recording"),
  listMeetings: (): Promise<Meeting[]> => invoke("list_meetings"),
  getMeeting: (id: string): Promise<Meeting> => invoke("get_meeting", { id }),
  deleteMeeting: (id: string): Promise<void> => invoke("delete_meeting", { id }),
  isRecording: (): Promise<boolean> => invoke("is_recording"),
  async trackUrl(id: string, trackFile: TrackFile): Promise<string> {
    const path: string = await invoke("track_path", { id, trackFile });
    return convertFileSrc(path);
  },
};
```

- [ ] **Step 3: Commit**

```bash
cd <project-root> && git add -A && git commit -m "feat: add frontend API wrapper and types"
```

---

## Task 9: Фронтенд — тестовая инфраструктура

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Установить dev-зависимости**

Run:
```bash
cd <project-root> && npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```
Expected: пакеты установлены.

- [ ] **Step 2: Создать `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

- [ ] **Step 3: Создать `src/test/setup.ts`**

```ts
import "@testing-library/jest-dom";
```

- [ ] **Step 4: Добавить скрипт теста в `package.json`**

В секцию `"scripts"` добавить:

```json
"test": "vitest run"
```

- [ ] **Step 5: Проверить, что vitest запускается (пока без тестов)**

Run:
```bash
cd <project-root> && npx vitest run
```
Expected: «No test files found» — это ок, инфраструктура работает.

- [ ] **Step 6: Commit**

```bash
cd <project-root> && git add -A && git commit -m "test: add vitest + testing-library setup"
```

---

## Task 10: Компонент RecordButton

**Files:**
- Create: `src/components/RecordButton.tsx`
- Create: `src/test/RecordButton.test.tsx`

- [ ] **Step 1: Написать падающий тест**

Создать `src/test/RecordButton.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { RecordButton } from "../components/RecordButton";

describe("RecordButton", () => {
  it("shows 'Начать запись' when idle and calls onStart on click", async () => {
    const onStart = vi.fn();
    render(
      <RecordButton recording={false} onStart={onStart} onStop={vi.fn()} />
    );
    const btn = screen.getByRole("button", { name: /Начать запись/i });
    await userEvent.click(btn);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("shows 'Остановить' when recording and calls onStop on click", async () => {
    const onStop = vi.fn();
    render(
      <RecordButton recording={true} onStart={vi.fn()} onStop={onStop} />
    );
    const btn = screen.getByRole("button", { name: /Остановить/i });
    await userEvent.click(btn);
    expect(onStop).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Запустить — должно падать**

Run:
```bash
cd <project-root> && npx vitest run src/test/RecordButton.test.tsx
```
Expected: FAIL — «Cannot find module '../components/RecordButton'».

- [ ] **Step 3: Создать `src/components/RecordButton.tsx`**

```tsx
interface Props {
  recording: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function RecordButton({ recording, onStart, onStop }: Props) {
  return (
    <button
      className={recording ? "rec-btn recording" : "rec-btn"}
      onClick={recording ? onStop : onStart}
    >
      {recording ? "⏹ Остановить" : "⏺ Начать запись"}
    </button>
  );
}
```

- [ ] **Step 4: Запустить — должно пройти**

Run:
```bash
cd <project-root> && npx vitest run src/test/RecordButton.test.tsx
```
Expected: 2 теста PASS.

- [ ] **Step 5: Commit**

```bash
cd <project-root> && git add -A && git commit -m "feat: add RecordButton component"
```

---

## Task 11: Компонент MeetingList

**Files:**
- Create: `src/components/MeetingList.tsx`
- Create: `src/test/MeetingList.test.tsx`

- [ ] **Step 1: Написать падающий тест**

Создать `src/test/MeetingList.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MeetingList } from "../components/MeetingList";
import type { Meeting } from "../types";

const meetings: Meeting[] = [
  {
    id: "a",
    created_at: "2026-06-04T10:00:00Z",
    title: "Звонок с Иваном",
    participants: "Иван",
    topic: "Планы",
    duration_secs: 65,
    folder: "a",
    status: "recorded",
  },
];

describe("MeetingList", () => {
  it("renders meeting titles and formatted duration", () => {
    render(<MeetingList meetings={meetings} onSelect={vi.fn()} />);
    expect(screen.getByText("Звонок с Иваном")).toBeInTheDocument();
    expect(screen.getByText(/1:05/)).toBeInTheDocument();
  });

  it("shows empty state when no meetings", () => {
    render(<MeetingList meetings={[]} onSelect={vi.fn()} />);
    expect(screen.getByText(/Пока нет записей/i)).toBeInTheDocument();
  });

  it("calls onSelect with id when a meeting is clicked", async () => {
    const onSelect = vi.fn();
    render(<MeetingList meetings={meetings} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("Звонок с Иваном"));
    expect(onSelect).toHaveBeenCalledWith("a");
  });
});
```

- [ ] **Step 2: Запустить — должно падать**

Run:
```bash
cd <project-root> && npx vitest run src/test/MeetingList.test.tsx
```
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Создать `src/components/MeetingList.tsx`**

```tsx
import type { Meeting } from "../types";

interface Props {
  meetings: Meeting[];
  onSelect: (id: string) => void;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MeetingList({ meetings, onSelect }: Props) {
  if (meetings.length === 0) {
    return <p className="empty">Пока нет записей. Нажми «Начать запись».</p>;
  }
  return (
    <ul className="meeting-list">
      {meetings.map((m) => (
        <li key={m.id} className="meeting-row" onClick={() => onSelect(m.id)}>
          <span className="meeting-title">{m.title}</span>
          <span className="meeting-meta">
            {new Date(m.created_at).toLocaleString()} · {formatDuration(m.duration_secs)}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Запустить — должно пройти**

Run:
```bash
cd <project-root> && npx vitest run src/test/MeetingList.test.tsx
```
Expected: 3 теста PASS.

- [ ] **Step 5: Commit**

```bash
cd <project-root> && git add -A && git commit -m "feat: add MeetingList component"
```

---

## Task 12: Компонент MeetingDetail (плеер двух дорожек)

**Files:**
- Create: `src/components/MeetingDetail.tsx`
- Create: `src/test/MeetingDetail.test.tsx`

- [ ] **Step 1: Написать падающий тест**

Создать `src/test/MeetingDetail.test.tsx`. Мокаем `api.trackUrl`, чтобы не дёргать Tauri.

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MeetingDetail } from "../components/MeetingDetail";
import type { Meeting } from "../types";

vi.mock("../api", () => ({
  api: {
    trackUrl: vi.fn(async (_id: string, file: string) => `mock://${file}`),
  },
}));

const meeting: Meeting = {
  id: "a",
  created_at: "2026-06-04T10:00:00Z",
  title: "Звонок с Иваном",
  participants: "Иван",
  topic: "Планы",
  duration_secs: 65,
  folder: "a",
  status: "recorded",
};

describe("MeetingDetail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders title and two labelled audio players", async () => {
    render(<MeetingDetail meeting={meeting} onBack={vi.fn()} />);
    expect(screen.getByText("Звонок с Иваном")).toBeInTheDocument();
    expect(screen.getByText(/Я \(микрофон\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Собеседник/i)).toBeInTheDocument();
    await waitFor(() => {
      const players = document.querySelectorAll("audio");
      expect(players.length).toBe(2);
      expect(players[0].getAttribute("src")).toBe("mock://mic.wav");
      expect(players[1].getAttribute("src")).toBe("mock://system.wav");
    });
  });
});
```

- [ ] **Step 2: Запустить — должно падать**

Run:
```bash
cd <project-root> && npx vitest run src/test/MeetingDetail.test.tsx
```
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Создать `src/components/MeetingDetail.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { Meeting } from "../types";
import { api } from "../api";

interface Props {
  meeting: Meeting;
  onBack: () => void;
}

export function MeetingDetail({ meeting, onBack }: Props) {
  const [micUrl, setMicUrl] = useState<string>("");
  const [systemUrl, setSystemUrl] = useState<string>("");

  useEffect(() => {
    api.trackUrl(meeting.id, "mic.wav").then(setMicUrl);
    api.trackUrl(meeting.id, "system.wav").then(setSystemUrl);
  }, [meeting.id]);

  return (
    <div className="meeting-detail">
      <button className="back" onClick={onBack}>
        ← Назад
      </button>
      <h2>{meeting.title}</h2>
      <p className="detail-meta">
        {new Date(meeting.created_at).toLocaleString()}
        {meeting.participants && ` · ${meeting.participants}`}
        {meeting.topic && ` · ${meeting.topic}`}
      </p>

      <div className="track">
        <span className="track-label">Я (микрофон)</span>
        {micUrl && <audio controls src={micUrl} />}
      </div>
      <div className="track">
        <span className="track-label">Собеседник (системный звук)</span>
        {systemUrl && <audio controls src={systemUrl} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Запустить — должно пройти**

Run:
```bash
cd <project-root> && npx vitest run src/test/MeetingDetail.test.tsx
```
Expected: тест PASS.

- [ ] **Step 5: Commit**

```bash
cd <project-root> && git add -A && git commit -m "feat: add MeetingDetail component with dual-track player"
```

---

## Task 13: Сборка App.tsx и стили

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css` (или создать, если скаффолд назвал иначе)

- [ ] **Step 1: Переписать `src/App.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Meeting } from "./types";
import { RecordButton } from "./components/RecordButton";
import { MeetingList } from "./components/MeetingList";
import { MeetingDetail } from "./components/MeetingDetail";
import "./App.css";

export default function App() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [recording, setRecording] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setMeetings(await api.listMeetings());
    setRecording(await api.isRecording());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleStart = async () => {
    await api.startRecording();
    setRecording(true);
  };

  const handleStop = async () => {
    await api.stopRecording();
    setRecording(false);
    await refresh();
  };

  const selected = meetings.find((m) => m.id === selectedId) ?? null;

  return (
    <main className="app">
      <header className="app-header">
        <h1>3uxo · третье ухо</h1>
        <RecordButton
          recording={recording}
          onStart={handleStart}
          onStop={handleStop}
        />
      </header>

      {selected ? (
        <MeetingDetail meeting={selected} onBack={() => setSelectedId(null)} />
      ) : (
        <MeetingList meetings={meetings} onSelect={setSelectedId} />
      )}
    </main>
  );
}
```

- [ ] **Step 2: Заменить `src/App.css` базовыми стилями**

```css
:root {
  font-family: system-ui, sans-serif;
  color: #1c1c1e;
  background: #f5f5f7;
}
.app {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px;
}
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}
.rec-btn {
  border: none;
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 15px;
  cursor: pointer;
  background: #0a84ff;
  color: white;
}
.rec-btn.recording {
  background: #ff3b30;
}
.empty {
  color: #8e8e93;
  text-align: center;
  margin-top: 48px;
}
.meeting-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.meeting-row {
  background: white;
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.meeting-row:hover {
  background: #ececf0;
}
.meeting-title {
  font-weight: 600;
}
.meeting-meta,
.detail-meta {
  color: #8e8e93;
  font-size: 13px;
}
.track {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.track-label {
  font-weight: 600;
  font-size: 14px;
}
.back {
  border: none;
  background: none;
  color: #0a84ff;
  cursor: pointer;
  padding: 0;
  margin-bottom: 12px;
}
audio {
  width: 100%;
}
```

> Если скаффолд не создал `App.css`, добавить `import "./App.css";` уже включён в шаге 1.

- [ ] **Step 3: Прогнать все фронтенд-тесты**

Run:
```bash
cd <project-root> && npx vitest run
```
Expected: все тесты (RecordButton, MeetingList, MeetingDetail) PASS.

- [ ] **Step 4: Проверить сборку фронтенда**

Run:
```bash
cd <project-root> && npx tsc --noEmit && npm run build
```
Expected: TypeScript без ошибок, Vite собирает `dist/`.

- [ ] **Step 5: Commit**

```bash
cd <project-root> && git add -A && git commit -m "feat: assemble App shell with library and detail views"
```

---

## Task 14: README и финальная проверка

**Files:**
- Create/Modify: `README.md`

- [ ] **Step 1: Написать `README.md`**

```markdown
# 3uxo — третье ухо

Локальное десктоп-приложение для записи, расшифровки и организации твоих созвонов.
Записывает звонок в любом приложении двумя дорожками (ты + собеседник), хранит всё
на твоём компьютере, расшифровывает локально через Whisper и помогает ИИ делать
выжимки и отвечать на вопросы по разговору.

## Статус

В разработке. План 1 (этот этап): каркас приложения, хранилище и библиотека встреч
с мок-рекордером. Реальный захват звука — План 2.

## Стек

Tauri 2 · Rust · React + TypeScript · SQLite · Whisper (локально).

## Разработка

Требуется Rust и Node.js.

```bash
npm install
npm run tauri dev      # запуск приложения
cargo test --manifest-path src-tauri/Cargo.toml   # тесты ядра
npm test               # тесты фронтенда
```
```

- [ ] **Step 2: Полный прогон всех тестов ядра**

Run:
```bash
cd <project-root>/src-tauri && cargo test
```
Expected: все тесты PASS (model, audio, storage, recorder, service).

- [ ] **Step 3: Полный прогон фронтенд-тестов**

Run:
```bash
cd <project-root> && npx vitest run
```
Expected: все тесты PASS.

- [ ] **Step 4: Ручной smoke-тест (требует GUI; выполняется на машине с дисплеем)**

Run:
```bash
cd <project-root> && npm run tauri dev
```
Проверить вручную:
1. Нажать «Начать запись» → кнопка станет красной «Остановить».
2. Нажать «Остановить» → в списке появится «Новая встреча».
3. Кликнуть встречу → открыть карточку, увидеть два плеера, нажать play (тишина 5 сек).
4. Вернуться назад — список на месте.

> На headless Linux-сервере этот шаг пропускается; вся логика уже покрыта
> автотестами. GUI-проверку выполнит пользователь на своей машине.

- [ ] **Step 5: Commit**

```bash
cd <project-root> && git add -A && git commit -m "docs: add README; finalize Plan 1"
```

---

## Итог Плана 1

После выполнения: работающее приложение с библиотекой встреч, сохранением в SQLite +
файлы и проигрыванием двух дорожек. Вся бизнес-логика покрыта тестами. Реальный звук
подключается в Плане 2 заменой `MockRecorder` на `WasapiRecorder` за тем же интерфейсом
`Recorder` — остальной код не меняется.
```
