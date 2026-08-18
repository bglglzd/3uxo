# План: аудиоредактор (v0.7.0)

Спека: [`../specs/2026-08-18-audio-editor-design.md`](../specs/2026-08-18-audio-editor-design.md)

## Шаги

1. **`core/src/edit.rs`** — `Range`, `Waveform`, `waveform()`, `merge_ranges()`,
   `map_time()`, `overlap()`, `apply_cuts()`, `remap_transcript()` + юнит-тесты.
   Регистрация модуля в `core/src/lib.rs`.
2. **`storage::Repo::update_duration`** + тест.
3. **`core/src/service.rs`** — `AudioEditState`, `audio_edit_state`,
   `apply_audio_edit_files`, `revert_audio_edit_files`, бэкап `*.orig.wav` /
   `transcript.orig.json` + тесты (запись двумя дорожками, импорт одной,
   повторная правка не перетирает бэкап, возврат оригинала).
4. **Команды** `waveform`, `audio_edit_state`, `apply_audio_edit`,
   `revert_audio_edit` в `commands.rs` + регистрация в `lib.rs`.
5. **`src/types.ts`, `src/api.ts`** — типы `AudioRange`/`Waveform`/
   `AudioEditState`, обёртки; `trackUrl(id, track, bust?)` с cache-buster.
6. **`src/audioedit.ts`** — чистая логика + `src/test/audioedit.test.ts`.
7. **`src/components/WaveTimeline.tsx`** — отрисовка дорожки и взаимодействие.
8. **`src/components/AudioEditor.tsx`** — экран редактора.
9. **`src/components/MeetingView.tsx`** — кнопка входа, переключение режима,
   перезагрузка аудио/расшифровки после правки.
10. **`src/App.css`** — стили редактора на токенах Auris.
11. **`src/test/AudioEditor.test.tsx`** — компонентные тесты.
12. **Версия 0.7.0** в `package.json` + `src-tauri/tauri.conf.json`;
    `docs/STATUS.md` — запись о фиче; `CLAUDE.md` §3/§4 — модуль и экран.
13. **Проверка**: `npx tsc --noEmit`, `npm test`, `npm run build` → PR → CI
    зелёный по `conclusion` → мерж → тег `v0.7.0` → проверка релиза.

## Порядок и зависимости

1 → 2 → 3 → 4 (бэкенд снизу вверх), затем 5 → 6 → 7 → 8 → 9 → 10 → 11.
Шаг 12 перед пушем, шаг 13 — после.
