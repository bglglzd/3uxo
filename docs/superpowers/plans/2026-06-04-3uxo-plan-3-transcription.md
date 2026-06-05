# 3uxo — План 3: Расшифровка (Whisper)

> REQUIRED SUB-SKILL: subagent-driven-development. Steps use `- [ ]`.

**Goal:** После записи встречу можно расшифровать: обе дорожки превращаются в единую ленту реплик «Я»/«Собеседник», сохраняются и показываются в карточке встречи.

**Architecture:** В `uxo-core` — `Transcriber` (trait) + `MockTranscriber`, модель `Transcript`, функция слияния дорожек, сервис расшифровки и хранение `transcript.json`. Реальный Whisper (`whisper-rs`) — за cargo-фичей `whisper` (опциональная, тяжёлая C++-сборка + модель), по умолчанию выключена, поэтому ядро тестируется на Linux без неё. Тонкие команды Tauri + UI расшифровки.

**Tech Stack:** Rust (whisper-rs за фичей), React.

## Структура файлов
- Create: `core/src/transcript.rs`, `core/src/transcriber.rs`, `core/src/whisper.rs` (feature-gated)
- Modify: `core/src/lib.rs`, `core/src/storage.rs` (update_status), `core/src/service.rs` (transcribe_meeting, load_transcript), `core/Cargo.toml` (optional whisper-rs + feature)
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs` (register), `src-tauri/Cargo.toml`
- Modify: `src/components/MeetingDetail.tsx`, `src/api.ts`, `src/types.ts` + tests

## Модель
- `Speaker` enum: `Me`, `Them` (serde lowercase).
- `Segment { start_secs: f64, end_secs: f64, text: String }` — сырой сегмент от транскрайбера.
- `TranscriptSegment { speaker: Speaker, start_secs: f64, end_secs: f64, text: String }`.
- `Transcript { segments: Vec<TranscriptSegment> }`.

## Слияние
`merge_tracks(mic: Vec<Segment>, system: Vec<Segment>) -> Transcript`: помечает mic→`Me`, system→`Them`, объединяет и сортирует по `start_secs` (стабильно). Пустые тексты пропускаются.

## Сервис
- `transcribe_meeting(t: &dyn Transcriber, repo, data_root, id) -> Transcript`: читает `mic.wav`/`system.wav`, транскрибирует обе, мёрджит, пишет `transcript.json` в папку встречи, ставит статус `transcribed`.
- `load_transcript(data_root, id) -> AppResult<Option<Transcript>>`.

## Whisper (feature `whisper`)
`WhisperTranscriber { model_path }` реализует `Transcriber` через whisper-rs: грузит модель, прогоняет аудио (16 кГц моно — как раз наш формат), отдаёт сегменты с таймкодами. Только под `#[cfg(feature = "whisper")]`.

## Команды
`transcribe(id) -> Transcript`, `get_transcript(id) -> Option<Transcript>`.

## UI
В карточке: кнопка «Расшифровать» (если нет расшифровки) → лента реплик с метками «Я»/«Собеседник». 

Полные TDD-шаги и точный код задаются исполнителю при запуске (как в Плане 1). Тесты ядра: слияние дорожек (порядок, метки, пропуск пустых), MockTranscriber, сервис (запись/чтение transcript.json, смена статуса), update_status. Команда `cargo test -p uxo-core` должна проходить БЕЗ фичи `whisper`.
