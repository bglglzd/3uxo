# 3uxo — План 2: Реальный захват звука (Windows / WASAPI)

**Goal:** Заменить `MockRecorder` на настоящий захват двух дорожек на Windows: микрофон («Я») и системный звук через loopback («Собеседник»), в формате нашего конвейера (WAV, моно, 16 кГц, 16 бит).

**Architecture:** `WasapiRecorder` реализует уже существующий trait `Recorder` (start/stop/is_recording), поэтому весь остальной код не меняется. Только Windows: модуль и зависимость `wasapi` спрятаны за `#[cfg(target_os = "windows")]` / `[target.'cfg(windows)'.dependencies]`, поэтому воркспейс продолжает собираться на Linux (там по-прежнему используется `MockRecorder`).

**Tech Stack:** Rust, крейт `wasapi` (HEnquist), `hound` для записи WAV.

> **СТАТУС: НЕ ПРОВЕРЕНО.** Этот код нельзя собрать на Linux-машине разработки
> (нет Windows и крейта `wasapi`). Он написан по документации/примеру `wasapi`
> и предназначен для сборки и отладки на Windows. Ниже — что проверить в первую
> очередь.

## Ключевая идея: autoconvert
WASAPI в shared-режиме с `autoconvert: true` сам переводит поток устройства
(обычно 48 кГц стерео float) в запрошенный формат. Запрашиваем сразу
**16 кГц, 1 канал, 16 бит int** — и получаем ровно то, что нужно Whisper, без
ручного ресемплинга.

## Loopback
Микрофон — `get_default_device(&Direction::Capture)`. Системный звук —
`get_default_device(&Direction::Render)`, а клиент инициализируется как `Capture`
(WASAPI loopback с рендер-устройства).

## Что проверить на Windows (риск-лист)
1. Версия крейта `wasapi` и точные имена методов (`DeviceEnumerator::new`,
   `get_default_device`, `get_iaudioclient`, `StreamMode::EventsShared`,
   `read_from_device_to_deque`, `set_get_eventhandle`, `wait_for_event`,
   `start_stream`/`stop_stream`) — API менялся между версиями; при ошибках
   сверить с `cargo doc -p wasapi` нужной версии.
2. Что loopback действительно берётся с Render-устройства как Capture-клиент.
3. Что `autoconvert: true` реально отдаёт 16 кГц моно i16 (иначе добавить
   ресемплинг, напр. `rubato`, и микс в моно).
4. Поведение при отсутствии устройства / тишине.

## Сборка с реальным звуком
```bash
npm run tauri build        # на Windows автоматически подхватит WasapiRecorder
# (для расшифровки также: --features whisper, см. План 3)
```

## Файлы
- Create: `core/src/wasapi_recorder.rs` (`#[cfg(target_os = "windows")]`)
- Modify: `core/src/lib.rs` (cfg-модуль), `core/Cargo.toml` (windows-зависимость)
- Modify: `src-tauri/src/lib.rs` (выбор рекордера по ОС)

## Проверка на Linux
`cargo test -p uxo-core` и существующие тесты должны проходить как раньше
(модуль и зависимость исключены на не-Windows).
