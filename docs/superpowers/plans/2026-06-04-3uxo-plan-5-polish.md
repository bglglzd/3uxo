# 3uxo — План 5: Полировка и релиз

**Goal:** Довести до удобного состояния и подготовить к публикации: удаление встречи из UI, таймер записи, глобальная горячая клавиша и системный трей, сборка релизов на GitHub, README.

**Architecture:** Фронтенд-улучшения тестируются здесь (vitest). Горячая клавиша (`tauri-plugin-global-shortcut`) и трей (`tauri` feature `tray-icon`) — только в `src-tauri`, не собираются на Linux, проверяются на Windows. CI — файл workflow с `tauri-apps/tauri-action`.

## Фронтенд (тестируется здесь)
- Кнопка удаления встречи в строке списка (`MeetingList`) с подтверждением; вызывает `api.deleteMeeting` и обновляет список.
- Таймер длительности во время записи (в `App`/`RecordButton`): идёт счёт `mm:ss`.
- Подписка на событие `recording-changed` (из бэкенда при старте/стопе по горячей клавише) → обновление состояния (с моком `@tauri-apps/api/event` в тестах).

## src-tauri (Windows; не проверяется здесь)
- `tauri-plugin-global-shortcut`: `Ctrl+Shift+R` — старт/стоп записи; после переключения эмитит событие `recording-changed`.
- Системный трей (`tauri` feature `tray-icon`): меню «Старт/Стоп», «Открыть», «Выход».
- Хелпер `commands::toggle_recording(&AppState, &AppHandle)` — общая логика для команды и горячей клавиши.

## Релиз
- `.github/workflows/release.yml` — сборка Windows-инсталляторов через `tauri-apps/tauri-action` по тегу `v*` (с фичей `whisper` опционально — задокументировать).
- README: что это, возможности, сборка (включая `--features whisper` и куда класть модель), приватность, статус планов.

## Проверка
- Здесь: `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `cargo test -p uxo-core`.
- На Windows: `npm run tauri build` (+ `--features whisper`), затем горячая клавиша/трей/полный цикл.
