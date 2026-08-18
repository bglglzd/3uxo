# Auris — «ваше третье ухо»

Локальный десктоп-стенографист: записывает встречи/звонки, расшифровывает,
разделяет голоса (диаризация) и делает ИИ-отчёты. **Приватность прежде всего** —
запись, расшифровка и диаризация выполняются локально; ИИ-функции опциональны и
идут через личный API-ключ пользователя.

> Это главный контекстный файл проекта. Подробный runbook релиза — в
> [`docs/RELEASE.md`](docs/RELEASE.md). Дизайн-кит бренда Auris — в
> `C:\Users\doc\Downloads\auris-rebrand\design_handoff_auris\` (README = токены/
> экраны, IMPLEMENTATION = как внедрять). ТЗ на ИИ-модуль —
> `C:\Users\doc\Downloads\Техническое задание для ИИ-модуля.docx`.

---

## 1. Бренд и идентичность (ВАЖНО: что НЕ переименовывать)

Продукт называется **Auris** (бывш. «3uxo / третье ухо», ребренд v0.4.0). Имя
exe — `Auris.exe`. Но **технический «3uxo» оставлен НАМЕРЕННО** — его смена ломает
авто-апдейт и стирает данные у существующих пользователей:

| Артефакт | Значение | Почему НЕ менять |
|---|---|---|
| `identifier` | `com.3uxo.app` (tauri.conf.json) | определяет папку данных (`%APPDATA%\com.3uxo.app`) и идентичность для апдейтера |
| репозиторий / updater endpoint | `github.com/bglglzd/3uxo` | endpoint авто-апдейта зашит на этот репо |
| `3uxo.db` | SQLite с встречами пользователя | переименование = потеря всех записей |
| `3uxo.log` | бэкенд-лог (диагностика) | — |
| ключи localStorage | `3uxo.settings/theme/labels.*/speakers.*` | переименование = слёт настроек/темы/подписей |

Видимое имя (productName, заголовок окна, тексты, README, иконка, exe) = **Auris**.

---

## 2. Стек и структура

- **Tauri 2** (Rust) + **React 19 + TypeScript + Vite** (фронтенд).
- Cargo-workspace, 2 крейта:
  - **`core/`** (`uxo-core`) — доменная логика без GUI/Tauri, собирается и тестится
    на любой ОС.
  - **`src-tauri/`** (`auris`, бинарь → `Auris.exe`; lib `auris_lib`) — тонкий
    Tauri-слой: команды (`commands.rs`), запуск/трей/хоткей/монитор (`lib.rs`).
- **`src/`** — React-фронтенд. **`docs/`** — документация + исторические планы
  (`docs/superpowers/`).

### Модули `core/src/`
`ai` (ИИ-бэкенд + промпты), `audio` (WAV-хелперы), `call_detector` (детект звонка
по аудио-сессиям WASAPI, Windows), `cli_transcriber` (внешний whisper-CLI),
`decode` (symphonia+rubato → 16кГц/моно/i16; +opus за фичей), `diarize`
(native-pyannote-rs/Burn за фичей), `edit` (карта громкости + вырезание
фрагментов + пересчёт расшифровки), `error`, `model`, `recorder` (трейт +
MockRecorder), `service` (сервис-слой: запись/импорт/расшифровка/правка/файлы), `storage`
(rusqlite, миграции), `transcript` (модель + merge/assign_speakers), `transcriber`
(трейт), `whisper` (whisper-rs, за фичей), `wasapi_recorder` (реальный захват на
Windows, `#[cfg(windows)]`).

### Cargo-фичи (`core` зеркалит в `src-tauri`)
- `whisper` — встроенный whisper.cpp (whisper-rs).
- `gpu` — whisper с Vulkan (включает `whisper`).
- `diarize` — диаризация (тяжёлый Burn).
- `opus` — декод Ogg/Opus (libopus через audiopus/cmake).
- **Релиз собирает `--features gpu,diarize,opus`**; **CI check-app —
  `whisper,diarize,opus`** (без GPU).

---

## 3. Как это работает (потоки данных)

### Запись (Windows, WASAPI)
`wasapi_recorder.rs` пишет ДВЕ дорожки (16кГц/моно/i16 WAV) в
`<app_data>/meetings/<id>/`:
- `mic.wav` — микрофон (Capture-устройство, **event-режим** — события приходят).
- `system.wav` — системный звук через loopback (Render-устройство). **Loopback в
  shared-режиме НЕ шлёт WASAPI-события** (`events_ok=0`), поэтому опрашивается по
  таймеру (polling, 8мс); микрофон — на event-режиме.
- `capture_loop` логирует в `3uxo.log`: `reads / events_ok / samples / peak`
  (peak≈0 → захвачена тишина).
- Старт/стоп — кнопка, глобальный хоткей или трей; событие `recording-changed`.

### Расшифровка (whisper)
- Команда `transcribe` (commands.rs). Модель скачивается при 1-м запуске (фаза
  `download`), путь `<app_data>`. Прогресс — событие `transcribe-progress`.
- **Записанные дорожки нормализуются** через `decode::decode_to_wav_16k_mono`
  (тот же декодер, что и импорт) ПЕРЕД whisper — выравнивает «сырой» WASAPI-WAV с
  рабочим путём импорта. Лог: `transcribed: mic=N segs, system=N segs`.
- Записанная встреча: `mic` (=«Я») + `system` (=«Собеседник») → `merge_tracks`.
  При выборе ≥2 собеседников системная дорожка диаризуется (`assign_speakers`).
- Импортированная встреча: одна дорожка `audio.wav` → whisper → (с фичей diarize)
  диаризация на N голосов.

### Импорт
`service::import_to_meeting` → `decode_to_wav_16k_mono(src, audio.wav)` (symphonia
+ rubato; opus отдельной фичей). Поддерживает m4a/mp3/wav/flac/ogg/opus и т.п.

### Диаризация
`diarize.rs` (фича `diarize`): native-pyannote-rs 0.1.4 (Burn, без ONNX). Модели
(.bpk) качаются при 1-м запуске. `assign_speakers` склеивает whisper↔диаризацию.

### Правка аудио (отдельный экран, v0.7.0)
`edit.rs`: `waveform` (пик+RMS по корзинам, 0..1000 — как `recording_levels`),
`apply_cuts` (PCM i16 → i16 без перекодирования), `remap_transcript` (сдвиг
времён реплик). `service::apply_audio_edit_files` режет ВСЕ дорожки встречи
одним набором вырезов (иначе «Я»/«Собеседник» разъедутся), перед первой правкой
кладёт бэкап `mic.orig.wav`/`system.orig.wav`/`audio.orig.wav` +
`transcript.orig.json`; `revert_audio_edit_files` возвращает оригинал. Команды:
`waveform`, `audio_edit_state`, `apply_audio_edit`, `revert_audio_edit`.
Фронт — `AudioEditor`/`WaveLane` + чистая логика `audioedit.ts`.

### ИИ (опционально, через ключ пользователя)
`ai.rs`: OpenAI-совместимый HTTP-бэкенд (`base_url`/`api_key`/`model` из настроек).
Функции: `suggest_metadata` (авто-заголовок, устойчив к ответу-массиву),
`brief_summary` (Краткое резюме), `summarize` (Выжимка), `analyze` (ИИ-анализ),
`to_literary_text` (Литературный текст), `answer_question`. Длинные разговоры —
map-reduce (`*_long`, порог `SUMMARY_CHUNK_CHARS`). Результаты сохраняются в
`<id>/brief.md|summary?|analysis.md|literary.md`.

### Глобальный хоткей + авто-запись
- `update_hotkey(accelerator)` (lib.rs) — настраиваемый глобальный хоткей старт/
  стоп (дефолт Ctrl+Shift+R). `setup_global_shortcut` не паникует при «занято»
  (unregister_all + register, иначе старт-краш). Фронт перерегистрирует при старте.
- Авто-запись звонков: `call_detector::any_active_call(processes)` +
  фоновый поток-монитор (`spawn_autorecord_monitor`) + команда `set_autorecord`.
  Конфиг приложений — `src/autorecord.ts`. **Движок собран, рантайм НЕ проверен.**

---

## 4. Фронтенд (`src/`)

- **Дизайн-система Auris** (`App.css`): CSS-токены на `:root`/`[data-theme]`
  (светлая/тёмная). Палитра: `--brand-grad` (сине-бирюзовый), `--teal`
  (приватность), `--record` (запись), `--violet` (ИИ/спикер-3), `--spk-0..5`
  (аватары спикеров). Шрифты: **Manrope** (заголовки/лого, `--font-display`) +
  **Golos Text** (UI, `--font-ui`) + JetBrains Mono. Keyframes: `ripple` (кольца-
  эхо), `recpulse`, `blink`, `wv` (эквалайзер).
- **`AurisMark.tsx`** — фирменный знак (ухо), градиент по теме. Лок-ап в сайдбаре:
  знак + `auris` │ `ваше третье ухо`.
- **Аудио-редактор**: `AudioEditor` (отдельный полноэкранный режим из плеера
  встречи — волна громкости по дорожкам, выделение протяжкой, вырезы, зум,
  предпрослушивание без вырезов, «Применить»/«Вернуть оригинал»), `WaveLane`
  (одна дорожка), `audioedit.ts` (вырезы/линейка/путь волны — чистые функции).
- Компоненты: `Sidebar`, `RecordButton`, `MeetingList`, `MeetingView`,
  `TranscriptView` (лента с аватарами-инициалами), `AiPanel` (pill «ИИ · ваш
  ключ»), `SettingsModal` (раскрывающиеся секции: Запись/хоткей, Авто-запись,
  Распознавание, ИИ, Диагностика; версия в футере), `ImportModal`, `HotkeyCapture`,
  `CopyLogButton`, `Markdown`.
- Состояние: `settings.ts` (localStorage `3uxo.settings`), `theme.ts`, `labels.ts`,
  `api.ts` (обёртки `invoke`). Тема применяется до рендера (`initTheme`).
- Экспорт: `export.ts` — TXT/MD (по реплике) + Стенограмма (сгруппировано). ИИ-
  блоки экспортятся в .md/.txt. (DOCX/PDF — в планах, см. §7.)

---

## 5. Сборка и запуск

```bash
npm install                       # зависимости фронта
npm run dev                       # vite dev (порт 1420) — UI без бэкенда
npm run build                     # tsc + vite build (проверка фронта)
npm test                          # vitest (юнит-тесты фронта)
npx tsc --noEmit                  # проверка типов
npm run tauri dev -- --features gpu,diarize,opus   # полное приложение (нужен Rust+Win)
```

- **ВАЖНО: локального Rust-тулчейна на этой машине НЕТ** → Rust собирается и
  проверяется ТОЛЬКО через CI (push в ветку). Фронт проверяется локально.
- **Версию держать синхронно** в `package.json` и `src-tauri/tauri.conf.json`.
- Превью UI: MCP `preview_*` (vite на localhost:1420). `MeetingView`/`AiPanel`
  без данных бэкенда не отрисовать; `SettingsModal` и старт-экран — можно.
  Скриншот-инструмент таймаутит на бесконечных анимациях (ripple) — для кадра
  заморозить (`*{animation:none}`) или убрать `.ripple-ring`.

---

## 6. Деплой (релиз) — кратко

Деплой = подписанный GitHub-релиз по тегу + `latest.json` для авто-апдейта.
Полный пошаговый runbook — [`docs/RELEASE.md`](docs/RELEASE.md). Кратко:

1. Ветка от `main` (прямой push в `main` блокируется авто-режимом → только через PR).
2. Бамп версии в `package.json` + `src-tauri/tauri.conf.json`.
3. Локально зелёные: `npx tsc --noEmit`, `npm test`, `npm run build`.
4. Push ветки → PR → **дождаться `conclusion: success`** (см. правило ниже).
5. `gh pr merge <N> --squash --delete-branch`.
6. На `main`: `git tag vX.Y.Z && git push origin vX.Y.Z` → `release.yml` соберёт
   (gpu,diarize,opus), подпишет, опубликует setup.exe/.msi/.sig + latest.json.
7. Проверить публикацию: `gh release view vX.Y.Z`, latest endpoint = vX.Y.Z.

- **CI** (`.github/workflows/ci.yml`, on push/PR): jobs `frontend` (ubuntu:
  npm ci/test/tsc/build), `core` (ubuntu: `cargo test -p uxo-core`), `check-app`
  (windows: npm build + `cargo check -p auris --features whisper,diarize,opus`).
- **Release** (`.github/workflows/release.yml`, on tag `v*`): Windows-сборка
  (Vulkan SDK + LLVM), подпись (секрет `TAURI_SIGNING_PRIVATE_KEY`), публикация
  (не draft, `releaseName: "Auris vX"`), `latest.json`.
- **Авто-апдейт**: `tauri-plugin-updater`, endpoint
  `https://github.com/bglglzd/3uxo/releases/latest/download/latest.json`. Юзеры
  обновляются на latest.

---

## 7. Текущее состояние

Последний релиз и незакрытые пункты — см. [`docs/STATUS.md`](docs/STATUS.md) (обновлять там, не здесь).

---

## 8. Правила и уроки (соблюдать!)

- **Проверять `conclusion` CI, а не код `gh run watch`.** `gh run watch` мог
  завершиться 0, пока сборка падала → так v0.5.0 уехал сломанным. Перед тегом:
  `gh run view <id> --json conclusion --jq .conclusion` == `success`.
- **Прямой push в `main` запрещён** (авто-режим) → только PR + `gh pr merge`.
  Push тега `git push origin <tag>` — РАЗРЕШ�ён.
- **Rust локально не собрать** → полагаться на CI (компиляция) + рантайм-тест
  пользователя для платформенного (WASAPI, диаризация).
- **Единый стиль Auris** для всего нового (токены, шрифты, знак, семантика цвета,
  3 обещания: приватность/спокойствие/живость). Не ломать дизайн-язык.
- **«Ничего не убираем — только добавляем»** — не удалять существующие функции
  (TXT/MD-экспорт, кнопки и т.п.) при доработках.
- **Превью перед пушем для UI** — показать live-превью, мержить после «ок».
- `gh pr edit --base` ломается (GraphQL projectCards) → ретаргет базы через REST:
  `gh api -X PATCH repos/bglglzd/3uxo/pulls/N -f base=main`.
- Коллаборатор: push есть, админа нет. Email коммитов: a.bur@me.com.

---

## 9. Частые команды (gh/git)

```bash
gh pr create --base main --head <branch> --title "..." --body "..."
gh pr merge <N> --squash --delete-branch
gh run list --workflow=ci.yml --branch <branch> --limit 1 --json databaseId --jq '.[0].databaseId'
gh run view <id> --json conclusion --jq .conclusion         # проверка результата
gh run list --workflow=release.yml --limit 3
gh release view vX.Y.Z --json tagName,isDraft,assets
gh api repos/bglglzd/3uxo/releases/latest --jq .tag_name
```
