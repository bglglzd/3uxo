# Устойчивый loopback + живые тайлы уровня — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собеседник больше не «пропадает» из записи (восстановление loopback + синхронизация дорожек), и во время записи в основном окне видны два тайла с бегущей волной уровня «Вы» / «Собеседник».

**Architecture:** Бэкенд-рекордер (`core`, без Tauri) отдаёт peak-уровень на дорожку через атомики → Tauri-команда `recording_levels`; фронт опрашивает её каждые ~60мс и рисует осциллограф. Параллельно `capture_loop` в WASAPI-рекордере получает заполнение тишиной по стенным часам (дорожки всегда равной длины) и watchdog переоткрытия loopback при заглохании/смене устройства.

**Tech Stack:** Rust (core `uxo-core`, Tauri-крейт `auris`, wasapi 0.15, hound), React 19 + TypeScript + Vite, vitest + @testing-library/react.

## Global Constraints

- **Rust локально НЕ собирается** — компиляция/тесты Rust только через CI (push ветки). Фронт (`npx tsc --noEmit`, `npm test`, `npm run build`) проверяется локально.
- **Не переименовывать** технический `3uxo` (identifier `com.3uxo.app`, ключи localStorage `3uxo.*`, `3uxo.db`, `3uxo.log`). Видимое имя — Auris.
- **«Ничего не убираем — только добавляем»** — существующие команды/кнопки/экспорт не ломать.
- **Дизайн-система Auris**: только существующие CSS-токены/шрифты/keyframes (`--brand-grad`, `--teal`, `--violet`, `recpulse`). Скриншот-инструмент таймаутит на бесконечных анимациях — новых бесконечных ripple не добавлять.
- **Версия синхронно** в `package.json` и `src-tauri/tauri.conf.json` (текущая 0.6.2 → целевая **0.6.3**).
- Прямой push в `main` запрещён → только PR + `gh pr merge`.
- Формат аудио: 16000 Гц, моно, i16. `SAMPLE_RATE = 16_000`.
- Email коммитов настроен в git (`3uxo` / a.bur@me.com). Каждый коммит завершать:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Тип уровней + метод трейта `levels()` + `MockRecorder`

**Files:**
- Modify: `core/src/recorder.rs`

**Interfaces:**
- Produces:
  - `pub struct TrackLevels { pub mic: u32, pub system: u32 }` (0..1000), derive `Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize`.
  - `Recorder::levels(&self) -> TrackLevels` — метод трейта **с дефолтной реализацией** `TrackLevels::default()` (чтобы `WasapiRecorder` компилировался до Task 5).
  - `MockRecorder::levels` — осциллирующие значения при записи, `{0,0}` в простое.

- [ ] **Step 1: Написать падающий тест** (в `#[cfg(test)] mod tests` файла `core/src/recorder.rs`, добавить к существующим)

```rust
    #[test]
    fn mock_levels_zero_when_idle_and_alive_when_recording() {
        let dir = tempfile::tempdir().unwrap();
        let rec = MockRecorder::new(2);

        // В простое — нули.
        assert_eq!(rec.levels(), TrackLevels { mic: 0, system: 0 });

        rec.start(&dir.path().join("mic.wav"), &dir.path().join("sys.wav"))
            .unwrap();

        // Во время записи за несколько опросов должны появиться ненулевые уровни
        // на обеих дорожках, и все значения в диапазоне 0..=1000.
        let mut max_mic = 0;
        let mut max_sys = 0;
        for _ in 0..64 {
            let l = rec.levels();
            assert!(l.mic <= 1000 && l.system <= 1000);
            max_mic = max_mic.max(l.mic);
            max_sys = max_sys.max(l.system);
        }
        assert!(max_mic > 0, "mic level never rose");
        assert!(max_sys > 0, "system level never rose");

        rec.stop().unwrap();
        assert_eq!(rec.levels(), TrackLevels { mic: 0, system: 0 });
    }
```

- [ ] **Step 2: Запустить тест — убедиться, что не компилируется/падает**

Локально Rust не собрать. Отметить, что проверка идёт на CI. Ожидаемо: не компилируется (`TrackLevels` и `MockRecorder.tick` не существуют, метода `levels` нет).

- [ ] **Step 3: Реализовать минимальный код**

Вверху `core/src/recorder.rs` добавить импорты:

```rust
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
```

Добавить тип (после `RecordingResult`):

```rust
/// Текущий уровень (пик) каждой дорожки, нормализован 0..1000.
/// Для живых индикаторов записи; читается-и-сбрасывается при опросе.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct TrackLevels {
    pub mic: u32,
    pub system: u32,
}
```

В трейт `Recorder` добавить метод с дефолтом:

```rust
    /// Текущий уровень дорожек для индикаторов. Дефолт — нули (реализации,
    /// не умеющие мерить уровень, ничего не показывают).
    fn levels(&self) -> TrackLevels {
        TrackLevels::default()
    }
```

В `MockRecorder` добавить поле-счётчик и инициализацию:

```rust
pub struct MockRecorder {
    fixed_secs: u64,
    state: Mutex<Option<(std::path::PathBuf, std::path::PathBuf)>>,
    tick: AtomicU64,
}

impl MockRecorder {
    pub fn new(fixed_secs: u64) -> Self {
        Self {
            fixed_secs,
            state: Mutex::new(None),
            tick: AtomicU64::new(0),
        }
    }
}
```

В `impl Recorder for MockRecorder` добавить:

```rust
    fn levels(&self) -> TrackLevels {
        if self.state.lock().unwrap().is_none() {
            return TrackLevels::default();
        }
        // Две несинхронные синусоиды 0..1000 — «живые» тайлы без бэкенда WASAPI.
        let t = self.tick.fetch_add(1, Ordering::Relaxed) as f64;
        let mic = (((t * 0.30).sin() * 0.5 + 0.5) * 1000.0) as u32;
        let system = (((t * 0.21 + 1.0).sin() * 0.5 + 0.5) * 1000.0) as u32;
        TrackLevels { mic, system }
    }
```

- [ ] **Step 4: Проверить — тест проходит (через CI в конце; локально пропустить)**

Отметить пункт как «проверяется job `core` в CI (`cargo test -p uxo-core`)».

- [ ] **Step 5: Commit**

```bash
git add core/src/recorder.rs
git commit -m "feat(core): TrackLevels + Recorder::levels() + MockRecorder осцилляция

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Tauri-команда `recording_levels`

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (регистрация в `invoke_handler`)

**Interfaces:**
- Consumes: `Recorder::levels()` и `TrackLevels` из Task 1; `AppState.recorder: Box<dyn Recorder>` (существует).
- Produces: команда `recording_levels(state) -> TrackLevels`.

- [ ] **Step 1: Реализовать команду**

В `src-tauri/src/commands.rs` рядом с `recording_state` (около строки 165) добавить:

```rust
/// Текущий уровень дорожек (0..1000) для живых индикаторов записи.
/// Не идёт запись → нули. Читается-и-сбрасывается (peak с прошлого опроса).
#[tauri::command]
pub fn recording_levels(state: tauri::State<AppState>) -> uxo_core::recorder::TrackLevels {
    state.recorder.levels()
}
```

(Импорт `Recorder` уже есть в файле — строка 11. `TrackLevels` берём по полному пути.)

- [ ] **Step 2: Зарегистрировать команду**

В `src-tauri/src/lib.rs` в списке `tauri::generate_handler![ ... ]` (около строки 281), рядом с `commands::recording_state,` добавить строку:

```rust
            commands::recording_levels,
```

- [ ] **Step 3: Проверка компиляции**

Локально Rust не собрать — проверяется job `check-app` в CI. Отметить пункт.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): команда recording_levels

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Компонент `RecordingMonitor` (бегущая волна) + FE-тип + тесты

**Files:**
- Modify: `src/types.ts` (добавить `TrackLevels`)
- Create: `src/components/RecordingMonitor.tsx`
- Create: `src/test/RecordingMonitor.test.tsx`
- Modify: `src/App.css` (стили тайлов)

**Interfaces:**
- Produces:
  - TS-тип `export type TrackLevels = { mic: number; system: number }` (0..1000).
  - `export function RecordingMonitor(props: { levels: TrackLevels; solo: boolean; elapsed: number })`.
- Consumes (в Task 4): App подаёт `levels`/`solo`/`elapsed`.

- [ ] **Step 1: Добавить тип в `src/types.ts`**

В конец `src/types.ts` добавить:

```ts
/** Текущий уровень (пик) дорожек записи, 0..1000. */
export type TrackLevels = { mic: number; system: number };
```

- [ ] **Step 2: Написать падающий тест** `src/test/RecordingMonitor.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RecordingMonitor } from "../components/RecordingMonitor";
import type { TrackLevels } from "../types";

function feed(levels: TrackLevels, times: number) {
  const { rerender } = render(
    <RecordingMonitor levels={levels} solo={false} elapsed={0} />,
  );
  // Новый объект-литерал на каждый кадр — меняет идентичность prop, как делает App.
  for (let i = 0; i < times; i++) {
    rerender(
      <RecordingMonitor
        levels={{ mic: levels.mic, system: levels.system }}
        solo={false}
        elapsed={i}
      />,
    );
  }
}

describe("RecordingMonitor", () => {
  it("рисует два тайла: Вы и Собеседник", () => {
    render(
      <RecordingMonitor levels={{ mic: 0, system: 0 }} solo={false} elapsed={0} />,
    );
    expect(screen.getByText(/Вы/)).toBeInTheDocument();
    expect(screen.getByText(/Собеседник/)).toBeInTheDocument();
  });

  it("в solo показывает только тайл «Вы»", () => {
    render(
      <RecordingMonitor levels={{ mic: 0, system: 0 }} solo={true} elapsed={0} />,
    );
    expect(screen.getByText(/Вы/)).toBeInTheDocument();
    expect(screen.queryByText(/Собеседник/)).not.toBeInTheDocument();
  });

  it("не показывает «тишина» в самом начале записи", () => {
    render(
      <RecordingMonitor levels={{ mic: 500, system: 500 }} solo={false} elapsed={0} />,
    );
    expect(screen.queryByText(/тишина/i)).not.toBeInTheDocument();
  });

  it("показывает предупреждение о тишине на молчащей дорожке", () => {
    // мик звучит, собеседник молчит ~3.3с (55 опросов × 60мс)
    feed({ mic: 500, system: 0 }, 55);
    const warnings = screen.getAllByText(/тишина/i);
    expect(warnings.length).toBe(1);
  });
});
```

- [ ] **Step 3: Запустить тест — убедиться, что падает**

Run: `npm test -- RecordingMonitor`
Expected: FAIL — модуль `../components/RecordingMonitor` не существует.

- [ ] **Step 4: Реализовать компонент** `src/components/RecordingMonitor.tsx`

```tsx
import { useEffect, useRef, useState } from "react";
import type { TrackLevels } from "../types";

interface Props {
  levels: TrackLevels;
  solo: boolean;
  elapsed: number;
}

const HISTORY = 130; // ~8с при опросе 60мс
const POLL_MS = 60;
const SILENCE_THRESH = 0.04; // перцептивная (0..1)
const SILENCE_WARN_SECS = 3;

// Перцептивная шкала: речь выглядит живо, тишина — плоско.
const scale = (v: number) => Math.sqrt(Math.max(0, Math.min(1000, v)) / 1000);

interface TileProps {
  title: string;
  icon: string;
  levels: number[]; // история 0..1, длиной HISTORY
  silenceSecs: number;
  variant: "me" | "peer";
}

function Tile({ title, icon, levels, silenceSecs, variant }: TileProps) {
  const w = HISTORY;
  const h = 40;
  const silent = silenceSecs >= SILENCE_WARN_SECS;
  return (
    <div className={`rec-tile rec-tile--${variant}`}>
      <div className="rec-tile-head">
        <span className="rec-tile-title">
          {icon} {title}
        </span>
        <span className="rec-tile-dot" aria-hidden="true" />
      </div>
      <svg
        className="rec-wave"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {levels.map((v, i) => {
          const barH = Math.max(0.6, v * h);
          return (
            <rect
              key={i}
              x={i}
              y={(h - barH) / 2}
              width={0.85}
              height={barH}
              rx={0.3}
            />
          );
        })}
      </svg>
      <div className="rec-tile-foot">
        {silent ? (
          <span className="rec-warn">⚠ тишина {Math.floor(silenceSecs)} сек</span>
        ) : (
          <span className="rec-ok">● запись</span>
        )}
      </div>
    </div>
  );
}

export function RecordingMonitor({ levels, solo }: Props) {
  const [micHist, setMicHist] = useState<number[]>(() =>
    Array(HISTORY).fill(0),
  );
  const [sysHist, setSysHist] = useState<number[]>(() =>
    Array(HISTORY).fill(0),
  );
  const micSilence = useRef(0);
  const sysSilence = useRef(0);

  useEffect(() => {
    const m = scale(levels.mic);
    const s = scale(levels.system);
    micSilence.current = m < SILENCE_THRESH ? micSilence.current + 1 : 0;
    sysSilence.current = s < SILENCE_THRESH ? sysSilence.current + 1 : 0;
    setMicHist((prev) => [...prev.slice(1), m]);
    setSysHist((prev) => [...prev.slice(1), s]);
  }, [levels]);

  const micSecs = (micSilence.current * POLL_MS) / 1000;
  const sysSecs = (sysSilence.current * POLL_MS) / 1000;

  return (
    <div className="rec-monitor">
      <Tile
        title="Вы"
        icon="🎙"
        levels={micHist}
        silenceSecs={micSecs}
        variant="me"
      />
      {!solo && (
        <Tile
          title="Собеседник"
          icon="🔊"
          levels={sysHist}
          silenceSecs={sysSecs}
          variant="peer"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Запустить тест — проходит**

Run: `npm test -- RecordingMonitor`
Expected: PASS (4 теста).

- [ ] **Step 6: Стили в `src/App.css`**

Добавить в конец `src/App.css` (использовать существующие токены; без бесконечных анимаций):

```css
/* --- Монитор записи: два тайла с бегущей волной --- */
.rec-monitor {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 720px;
  margin: 48px auto;
  width: 100%;
  padding: 0 24px;
}
.rec-tile {
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 16px 18px;
  background: var(--surface);
}
.rec-tile-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.rec-tile-title {
  font-family: var(--font-display);
  font-weight: 600;
}
.rec-tile-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--record);
  animation: recpulse 1.6s ease-in-out infinite;
}
.rec-wave {
  width: 100%;
  height: 56px;
  display: block;
}
.rec-tile--me .rec-wave rect {
  fill: var(--teal);
}
.rec-tile--peer .rec-wave rect {
  fill: var(--violet);
}
.rec-tile-foot {
  margin-top: 8px;
  font-size: 13px;
}
.rec-ok {
  color: var(--muted);
}
.rec-warn {
  color: var(--record);
  font-weight: 600;
}
```

(Если токенов `--surface`/`--border`/`--muted` в файле нет — заменить на фактические имена из `:root`. Проверить `grep -n "^\s*--" src/App.css`.)

- [ ] **Step 7: Проверка типов и сборки**

Run: `npx tsc --noEmit && npm run build`
Expected: без ошибок.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/components/RecordingMonitor.tsx src/test/RecordingMonitor.test.tsx src/App.css
git commit -m "feat(ui): RecordingMonitor — бегущая волна уровня двух дорожек

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Проводка монитора и опроса уровней в `App.tsx` + `api.ts`

**Files:**
- Modify: `src/api.ts` (обёртка `recordingLevels`)
- Modify: `src/App.tsx` (импорт, состояние, опрос, рендер)

**Interfaces:**
- Consumes: `api.recordingLevels()` (Task 2 команда), `RecordingMonitor` (Task 3), тип `TrackLevels` (Task 3).
- Produces: во время записи основное окно показывает монитор.

- [ ] **Step 1: Обёртка в `src/api.ts`**

Рядом с `recordingState` (строка 44) добавить:

```ts
  recordingLevels: (): Promise<TrackLevels> => inv("recording_levels"),
```

Убедиться, что `TrackLevels` импортирован в `api.ts` (в начале файла добавить к существующему импорту типов `import type { ..., TrackLevels } from "./types";` — проверить фактическую строку импорта типов).

- [ ] **Step 2: Импорт и состояние в `src/App.tsx`**

Добавить импорт (рядом со строкой 9):

```tsx
import { RecordingMonitor } from "./components/RecordingMonitor";
```

Расширить импорт типов (строка 6) до:

```tsx
import type { Meeting, TranscribeState, TrackLevels } from "./types";
```

Добавить состояние (рядом со строкой 28):

```tsx
  const [levels, setLevels] = useState<TrackLevels>({ mic: 0, system: 0 });
```

- [ ] **Step 3: Опрос уровней (после таймера записи, ~строка 85)**

```tsx
  // Живые уровни дорожек: опрос, пока идёт запись и не на паузе.
  useEffect(() => {
    if (!recording || paused) return;
    const id = setInterval(async () => {
      try {
        setLevels(await api.recordingLevels());
      } catch {
        /* бэкенд недоступен — молча пропускаем кадр */
      }
    }, 60);
    return () => clearInterval(id);
  }, [recording, paused]);
```

- [ ] **Step 4: Рендер монитора в основном окне**

В `<main className="content">` (строка 212) заменить `{selected ? (` на приоритет записи:

```tsx
      <main className="content">
        {recording ? (
          <RecordingMonitor levels={levels} solo={solo} elapsed={elapsed} />
        ) : selected ? (
          <MeetingView
            key={selected.id}
            meeting={selected}
            transState={trans[selected.id]}
            onTranscribe={(speakerCount, soloFlag) =>
              startTranscription(selected.id, speakerCount, soloFlag)
            }
            onMetaSaved={refresh}
          />
        ) : (
```

(Остальная ветка `empty` без изменений; закрывающие скобки `)}` остаются.)

- [ ] **Step 5: Проверка типов, тестов, сборки**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: всё зелёное; существующие тесты (в т.ч. `RecordButton`) не сломаны.

- [ ] **Step 6: Commit**

```bash
git add src/api.ts src/App.tsx
git commit -m "feat(ui): опрос recording_levels и показ RecordingMonitor при записи

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: WASAPI-рекордер — уровни + устойчивость (silence-fill, watchdog, non-fatal)

**Files:**
- Modify: `core/src/wasapi_recorder.rs`

**Interfaces:**
- Consumes: `TrackLevels` из Task 1.
- Produces: `impl Recorder::levels for WasapiRecorder`; устойчивый `capture_loop`.
- Внимание: файл `#![cfg(target_os = "windows")]` — **не собирается локально и на ubuntu-джобе `core`**; компилируется только в CI `check-app` (windows). Юнит-тестов нет; корректность подтверждает рантайм-тест пользователя.

- [ ] **Step 1: Импорты, константы, поля структуры**

Заменить импорты вверху `core/src/wasapi_recorder.rs`:

```rust
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use wasapi::{AudioCaptureClient, AudioClient, Direction, Handle, SampleType, ShareMode, WaveFormat};

use crate::audio::wav_duration_secs;
use crate::error::{AppError, AppResult};
use crate::recorder::{Recorder, RecordingResult, TrackLevels};

const SAMPLE_RATE: u32 = 16_000;
/// Порог заглохания loopback: нет данных дольше — переоткрываем поток.
const STALL_SECS: f64 = 2.0;
/// Сколько подряд неудачных переоткрытий терпим, прежде чем сдаться.
const MAX_REOPEN_FAILS: u32 = 5;
```

> Примечание для исполнителя: точные имена типов `AudioClient`, `AudioCaptureClient`, `Handle` из `wasapi 0.15` подтвердить компиляцией в CI `check-app`; при расхождении поправить по ошибке компилятора (тип возвращается `get_iaudioclient`/`get_audiocaptureclient`/`set_get_eventhandle`).

Расширить структуру и `new`:

```rust
pub struct WasapiRecorder {
    running: Mutex<Option<Running>>,
    mic_level: Arc<AtomicU32>,
    system_level: Arc<AtomicU32>,
}

impl WasapiRecorder {
    pub fn new() -> Self {
        Self {
            running: Mutex::new(None),
            mic_level: Arc::new(AtomicU32::new(0)),
            system_level: Arc::new(AtomicU32::new(0)),
        }
    }
}
```

- [ ] **Step 2: Пробросить атомики в потоки (`start`) и добавить `levels`**

В `impl Recorder for WasapiRecorder::start`, заменить спавн потоков:

```rust
        let mic_level = self.mic_level.clone();
        let sys_level = self.system_level.clone();

        let mic = std::thread::spawn(move || {
            capture_loop(mic_pb, Source::Mic, stop_mic, mic_level)
        });
        let system = std::thread::spawn(move || {
            capture_loop(sys_pb, Source::Loopback, stop_sys, sys_level)
        });
```

Добавить в `impl Recorder for WasapiRecorder` метод:

```rust
    fn levels(&self) -> TrackLevels {
        if self.running.lock().unwrap().is_none() {
            return TrackLevels::default();
        }
        // Читаем-и-сбрасываем пик с прошлого опроса; нормализуем 0..32767 → 0..1000.
        let mic_raw = self.mic_level.swap(0, Ordering::Relaxed);
        let sys_raw = self.system_level.swap(0, Ordering::Relaxed);
        TrackLevels {
            mic: mic_raw * 1000 / 32767,
            system: sys_raw * 1000 / 32767,
        }
    }
```

- [ ] **Step 3: Helper открытия потока `open_stream`**

Добавить перед `capture_loop`:

```rust
/// Открывает (или переоткрывает) поток захвата на ТЕКУЩЕМ дефолтном устройстве.
/// Для loopback берёт Render-устройство, но клиент инициализирует как Capture.
/// Возврат: (клиент, capture-клиент, event-handle) с уже запущенным стримом.
fn open_stream(
    source: Source,
    format: &WaveFormat,
) -> AppResult<(AudioClient, AudioCaptureClient, Handle)> {
    let device_direction = match source {
        Source::Mic => Direction::Capture,
        Source::Loopback => Direction::Render,
    };
    let device = wasapi::get_default_device(&device_direction)
        .map_err(|e| AppError::Audio(format!("wasapi: default device: {e}")))?;
    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|e| AppError::Audio(format!("wasapi: get_iaudioclient: {e}")))?;
    let (_def_time, min_time) = audio_client
        .get_periods()
        .map_err(|e| AppError::Audio(format!("wasapi: get_periods: {e}")))?;
    audio_client
        .initialize_client(format, min_time, &Direction::Capture, &ShareMode::Shared, true)
        .map_err(|e| AppError::Audio(format!("wasapi: initialize_client: {e}")))?;
    let h_event = audio_client
        .set_get_eventhandle()
        .map_err(|e| AppError::Audio(format!("wasapi: eventhandle: {e}")))?;
    let capture_client = audio_client
        .get_audiocaptureclient()
        .map_err(|e| AppError::Audio(format!("wasapi: capture_client: {e}")))?;
    audio_client
        .start_stream()
        .map_err(|e| AppError::Audio(format!("wasapi: start_stream: {e}")))?;
    Ok((audio_client, capture_client, h_event))
}
```

- [ ] **Step 4: Переписать `capture_loop`**

Полностью заменить функцию `capture_loop` (сигнатура получает `level`):

```rust
/// Поток захвата одной дорожки: пишет WAV до сигнала stop.
/// Заполняет тишиной по стенным часам (дорожки равной длины) и — для loopback —
/// переоткрывает поток при заглохании/ошибке (смена устройства, инвалидация).
fn capture_loop(
    path: PathBuf,
    source: Source,
    stop: Arc<AtomicBool>,
    level: Arc<AtomicU32>,
) -> AppResult<()> {
    let label = match source {
        Source::Mic => "mic",
        Source::Loopback => "system",
    };
    let _ = wasapi::initialize_mta();

    let format = WaveFormat::new(16, 16, &SampleType::Int, SAMPLE_RATE as usize, 1, None);
    let blockalign = format.get_blockalign() as usize;

    let (mut client, mut capture, mut h_event) = open_stream(source, &format)?;

    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        hound::WavWriter::create(&path, spec).map_err(|e| AppError::Audio(e.to_string()))?;

    dlog(&path, &format!("{label}: stream started (blockalign={blockalign})"));

    // Диагностика.
    let mut reads: u64 = 0;
    let mut events_ok: u64 = 0;
    let mut samples: u64 = 0;
    let mut peak: i32 = 0;

    // Синхронизация по стенным часам и watchdog.
    let started = Instant::now();
    let mut samples_written: u64 = 0; // включая тишину-заполнение
    let mut silence_filled: u64 = 0;
    let mut last_data = Instant::now();
    let mut reopen_fails: u32 = 0;
    let mut gave_up = false;

    let mut queue: VecDeque<u8> = VecDeque::new();
    while !stop.load(Ordering::Relaxed) {
        let mut need_reopen = false;

        // --- Чтение (для loopback ошибка не фатальна) ---
        match capture.read_from_device_to_deque(&mut queue) {
            Ok(()) => {}
            Err(e) => match source {
                Source::Loopback if !gave_up => {
                    dlog(&path, &format!("{label}: read error: {e} — will reopen"));
                    need_reopen = true;
                }
                _ => return Err(AppError::Audio(format!("wasapi: read: {e}"))),
            },
        }
        reads += 1;

        // --- Слив очереди в сэмплы ---
        let mut produced: u64 = 0;
        while queue.len() >= blockalign {
            let lo = queue.pop_front().unwrap();
            let hi = queue.pop_front().unwrap();
            for _ in 2..blockalign {
                queue.pop_front();
            }
            let sample = i16::from_le_bytes([lo, hi]);
            let amp = (sample as i32).abs();
            if amp > peak {
                peak = amp;
            }
            level.fetch_max(amp as u32, Ordering::Relaxed);
            writer
                .write_sample(sample)
                .map_err(|e| AppError::Audio(e.to_string()))?;
            samples_written += 1;
            samples += 1;
            produced += 1;
        }
        if produced > 0 {
            last_data = Instant::now();
        }

        // --- Заполнение тишиной по стенным часам (обе дорожки) ---
        let expected = (started.elapsed().as_secs_f64() * SAMPLE_RATE as f64) as u64;
        if expected > samples_written + (SAMPLE_RATE as u64 / 10) {
            let pad = expected - samples_written;
            for _ in 0..pad {
                writer
                    .write_sample(0i16)
                    .map_err(|e| AppError::Audio(e.to_string()))?;
            }
            samples_written += pad;
            silence_filled += pad;
        }

        // --- Watchdog заглохания (только loopback) ---
        if matches!(source, Source::Loopback)
            && !gave_up
            && !need_reopen
            && last_data.elapsed().as_secs_f64() > STALL_SECS
        {
            dlog(&path, &format!("{label}: stalled {STALL_SECS}s — will reopen"));
            need_reopen = true;
        }

        // --- Переоткрытие потока ---
        if need_reopen && !gave_up {
            match open_stream(source, &format) {
                Ok((c, cc, h)) => {
                    let _ = client.stop_stream();
                    client = c;
                    capture = cc;
                    h_event = h;
                    reopen_fails = 0;
                    dlog(&path, &format!("{label}: reopened ok"));
                }
                Err(e) => {
                    reopen_fails += 1;
                    dlog(&path, &format!("{label}: reopen failed ({reopen_fails}): {e}"));
                    if reopen_fails >= MAX_REOPEN_FAILS {
                        gave_up = true;
                        dlog(&path, &format!("{label}: giving up — silence to end"));
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
            }
            last_data = Instant::now(); // не долбить переоткрытие каждый тик
        }

        // --- Темп опроса ---
        match source {
            Source::Mic => {
                if h_event.wait_for_event(100).is_ok() {
                    events_ok += 1;
                }
            }
            Source::Loopback => {
                std::thread::sleep(Duration::from_millis(8));
            }
        }
    }

    // Финальное выравнивание до полной длительности.
    let expected = (started.elapsed().as_secs_f64() * SAMPLE_RATE as f64) as u64;
    if expected > samples_written {
        let pad = expected - samples_written;
        for _ in 0..pad {
            let _ = writer.write_sample(0i16);
        }
        silence_filled += pad;
    }

    dlog(
        &path,
        &format!(
            "{label}: stop — reads={reads}, events_ok={events_ok}, samples={samples}, peak={peak}, silence_filled={silence_filled}, reopen_fails={reopen_fails}"
        ),
    );

    let _ = client.stop_stream();
    writer
        .finalize()
        .map_err(|e| AppError::Audio(e.to_string()))?;
    Ok(())
}
```

> Примечание: `h_event` для loopback не используется в ожидании (там `sleep`), но переприсваивается при reopen — допустимо; при желании пометить `let _ = &h_event;`. Если компилятор ругается на «unused assignment» для loopback-ветки — оставить как есть (используется в Mic-ветке); предупреждения не блокируют CI.

- [ ] **Step 5: Компиляция в CI**

Локально не собрать. Проверяется job `check-app` (windows, `cargo check -p auris --features whisper,diarize,opus`). Отметить пункт; фактическая проверка — на пуше ветки (Task 6).

- [ ] **Step 6: Commit**

```bash
git add core/src/wasapi_recorder.rs
git commit -m "fix(recording): устойчивый loopback (silence-fill + watchdog reopen) + уровни дорожек

Собеседник больше не пропадает при заглохании/смене устройства: поток
переоткрывается, обе дорожки выравниваются по стенным часам. Плюс peak-уровни
для живых тайлов записи.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Версия 0.6.3, зелёный CI, PR

**Files:**
- Modify: `package.json` (version)
- Modify: `src-tauri/tauri.conf.json` (version)

**Interfaces:**
- Consumes: все предыдущие задачи.
- Produces: PR в `main`, зелёный CI (`frontend`, `core`, `check-app`).

- [ ] **Step 1: Бамп версии**

В `package.json` установить `"version": "0.6.3"`. В `src-tauri/tauri.conf.json` установить `"version": "0.6.3"`. Свериться:

```bash
grep -n '"version"' package.json src-tauri/tauri.conf.json
```

Оба должны показать `0.6.3`.

- [ ] **Step 2: Локальная проверка фронта**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: всё зелёное.

- [ ] **Step 3: Commit версии**

```bash
git add package.json src-tauri/tauri.conf.json
git commit -m "chore: версия 0.6.3

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Push ветки и PR**

```bash
git push -u origin feat/loopback-resilience-live-meters
gh pr create --base main --head feat/loopback-resilience-live-meters \
  --title "fix(recording): устойчивый loopback + живые тайлы уровня (0.6.3)" \
  --body "Собеседник больше не пропадает из записи: silence-fill выравнивает дорожки по стенным часам, watchdog переоткрывает loopback при заглохании/смене устройства, ошибки чтения loopback не валят запись. Плюс два тайла с бегущей волной уровня («Вы»/«Собеседник») в основном окне во время записи — видно, что звук пишется.

Спека: docs/superpowers/specs/2026-07-06-loopback-resilience-and-live-meters-design.md
План: docs/superpowers/plans/2026-07-06-loopback-resilience-and-live-meters.md

Рантайм-проверка (Windows, за пользователем): звонок со сменой устройства/паузами — собеседник в расшифровке не пропадает; тайлы шевелятся у обеих дорожек.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 5: Дождаться зелёного CI (проверять `conclusion`, не `gh run watch`)**

```bash
RUN=$(gh run list --workflow=ci.yml --branch feat/loopback-resilience-live-meters --limit 1 --json databaseId --jq '.[0].databaseId')
gh run view "$RUN" --json conclusion --jq .conclusion
```

Expected: `success`. При падении — читать лог упавшей джобы, чинить, коммитить, повторять. **Не тегать/не мержить, пока `conclusion` != `success`.**

- [ ] **Step 6: Остановиться на ревью пользователя**

Не мержить автоматически. Сообщить пользователю: CI зелёный, PR готов к ревью и мержу; тег/релиз 0.6.3 — по его команде (runbook `docs/RELEASE.md`), после рантайм-проверки записи на Windows.

---

## Self-Review

**Spec coverage:**
- Silence-fill обеих дорожек → Task 5 Step 4 (блок «Заполнение тишиной»). ✅
- Watchdog + reopen loopback → Task 5 Step 4 (блоки watchdog/переоткрытие) + `open_stream` Step 3. ✅
- Non-fatal read errors loopback → Task 5 Step 4 (match на `read_from_device_to_deque`). ✅
- Уровни через атомики + `levels()` + команда → Task 1 (MockRecorder), Task 5 (WasapiRecorder), Task 2 (команда). ✅
- MockRecorder осцилляция для локального превью → Task 1. ✅
- `RecordingMonitor` бегущая волна + solo (только «Вы») + «тишина N сек» → Task 3. ✅
- Опрос ~60мс + рендер в основном окне при записи → Task 4. ✅
- Токены Auris/без бесконечных ripple → Task 3 Step 6 (использованы `recpulse`, `--teal`/`--violet`). ✅
- Тесты: vitest компонента (Task 3), юнит MockRecorder (Task 1); бэкенд — CI+рантайм. ✅
- Версия 0.6.3 в двух файлах, зелёный CI, PR → Task 6. ✅

**Placeholder scan:** плейсхолдеров нет; весь код приведён целиком. Единственные явно отложенные проверки — компиляция Rust на CI (ограничение среды, зафиксировано в Global Constraints), не «TODO».

**Type consistency:**
- `TrackLevels { mic, system }` — одинаково в core (`u32`), TS (`number`), команде. ✅
- `RecordingMonitor` props `{ levels, solo, elapsed }` — совпадают между Task 3 (объявление/тесты) и Task 4 (вызов). ✅
- `capture_loop(path, source, stop, level)` — сигнатура и вызовы из `start` совпадают (Task 5 Steps 2 и 4). ✅
- `open_stream(source, format) -> (AudioClient, AudioCaptureClient, Handle)` — возврат совпадает с местами присваивания в `capture_loop`. ✅
- Команда `recording_levels` зарегистрирована (Task 2 Step 2) и вызывается как `api.recordingLevels` → `inv("recording_levels")` (Task 4 Step 1). ✅
