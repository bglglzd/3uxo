import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Meeting, TrackFile, Waveform } from "../types";
import { api } from "../api";
import { clock } from "../export";
import { getLabels, nameForSpeaker } from "../labels";
import {
  MIN_CUT_SECS,
  clockPrecise,
  cutsTotal,
  invertCuts,
  keptDuration,
  normalizeCut,
  parseClock,
  rulerStep,
  rulerTicks,
  skipTarget,
  toRanges,
  type Cut,
} from "../audioedit";
import { WaveLane } from "./WaveLane";
import { ConfirmDialog } from "./ConfirmDialog";
import { CopyLogButton } from "./CopyLogButton";

interface Props {
  meeting: Meeting;
  /// Выйти из редактора обратно во встречу.
  onClose: () => void;
  /// Правка применена (или отменена) — встреча в БД изменилась.
  onApplied: (meeting: Meeting) => void;
}

/// Сколько корзин громкости просить у бэкенда: хватает на зум ×16 по всей
/// записи, при этом данные остаются лёгкими (несколько десятков КБ).
const BUCKETS = 4000;
/// Ширина столбца волны на экране (px) — плотнее уже не читается.
const COL_PX = 2;
const ZOOMS = [1, 2, 4, 8, 16];
/// Ширина таймлайна, если измерить не удалось (jsdom в тестах).
const FALLBACK_WIDTH = 900;

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const IconBack = () => (
  <svg {...ICON}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
const IconPlay = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.5-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5Z" />
  </svg>
);
const IconPause = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" rx="1.2" />
    <rect x="14" y="5" width="4" height="14" rx="1.2" />
  </svg>
);
const IconScissors = () => (
  <svg {...ICON}>
    <circle cx="6" cy="6" r="2.6" />
    <circle cx="6" cy="18" r="2.6" />
    <path d="M20 4 8.5 15.5M20 20 8.5 8.5" />
  </svg>
);
const IconKeep = () => (
  <svg {...ICON}>
    <path d="M7 4v13a3 3 0 0 0 3 3h7" />
    <path d="M20 17H7a3 3 0 0 1-3-3V4" />
  </svg>
);
const IconUndo = () => (
  <svg {...ICON}>
    <path d="M4 8h9a5 5 0 0 1 0 10H8" />
    <path d="M7 5 4 8l3 3" />
  </svg>
);
const IconRedo = () => (
  <svg {...ICON}>
    <path d="M20 8h-9a5 5 0 0 0 0 10h5" />
    <path d="m17 5 3 3-3 3" />
  </svg>
);
const IconZoomIn = () => (
  <svg {...ICON}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M8.5 11h5M11 8.5v5M16 16l4 4" />
  </svg>
);
const IconZoomOut = () => (
  <svg {...ICON}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M8.5 11h5M16 16l4 4" />
  </svg>
);
const IconRestore = () => (
  <svg {...ICON}>
    <path d="M4 5v5h5" />
    <path d="M5.6 14a7.5 7.5 0 1 0 1.2-7.4L4 10" />
  </svg>
);
const IconCheck = () => (
  <svg {...ICON}>
    <path d="m5 13 4.5 4.5L19 7" />
  </svg>
);
const IconClose = () => (
  <svg {...ICON} strokeWidth={2.4}>
    <path d="M7 7l10 10M17 7 7 17" />
  </svg>
);
const IconSaved = () => (
  <svg {...ICON} strokeWidth={1.9}>
    <path d="M12 3 4 6v5c0 5 3.4 8 8 10 4.6-2 8-5 8-10V6l-8-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
const IconArrowRight = () => (
  <svg {...ICON} strokeWidth={1.9}>
    <path d="M4 12h15M14 7l5 5-5 5" />
  </svg>
);

/// Подпись дорожки в редакторе: имена берём те же, что в расшифровке.
function laneName(track: TrackFile, meetingId: string): string {
  const labels = getLabels(meetingId);
  if (track === "mic.wav") return nameForSpeaker(labels, "me");
  if (track === "system.wav") return nameForSpeaker(labels, "them");
  return "Запись";
}

function laneTone(track: TrackFile): "me" | "peer" | "single" {
  if (track === "mic.wav") return "me";
  if (track === "system.wav") return "peer";
  return "single";
}

/// Отдельный экран правки аудио: волна громкости по дорожкам, выделение
/// протяжкой, вырезание фрагментов, предпрослушивание результата и запись
/// правки в файлы встречи (с сохранением оригинала).
export function AudioEditor({ meeting, onClose, onApplied }: Props) {
  const [tracks, setTracks] = useState<TrackFile[]>([]);
  const [waves, setWaves] = useState<Partial<Record<TrackFile, Waveform>>>({});
  const [urls, setUrls] = useState<Partial<Record<TrackFile, string>>>({});
  const [hasOriginal, setHasOriginal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /// Метка версии файлов: после правки перечитываем волну и аудио.
  const [version, setVersion] = useState(0);

  // Список вырезов живёт в истории — так undo/redo не расходятся с состоянием.
  const [hist, setHist] = useState<{ list: Cut[][]; i: number }>({
    list: [[]],
    i: 0,
  });
  const cuts = hist.list[hist.i];
  const setCuts = useCallback((next: Cut[]) => {
    setHist((h) => ({ list: [...h.list.slice(0, h.i + 1), next], i: h.i + 1 }));
  }, []);
  const resetHist = useCallback(() => setHist({ list: [[]], i: 0 }), []);

  const [sel, setSel] = useState<Cut | null>(null);
  const [selNonce, setSelNonce] = useState(0);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [skip, setSkip] = useState(true);
  const [pending, setPending] = useState<"apply" | "revert" | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  // Последние время/выделение для эффекта зума (без лишних перерисовок).
  const timeRef = useRef(0);
  const selRef = useRef<Cut | null>(null);
  const audioRefs = useRef<Partial<Record<TrackFile, HTMLAudioElement | null>>>(
    {},
  );

  timeRef.current = time;
  selRef.current = sel;

  const duration = useMemo(() => {
    const fromWaves = Object.values(waves).reduce(
      (max, w) => Math.max(max, w?.duration_secs ?? 0),
      0,
    );
    return fromWaves > 0 ? fromWaves : meeting.duration_secs;
  }, [waves, meeting.duration_secs]);

  // Ширина таймлайна нужна для плотности волны: чем больше зум, тем больше
  // столбцов (до предела, заданного данными).
  const [laneWidth, setLaneWidth] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    const el = lanesRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setLaneWidth(el.clientWidth || FALLBACK_WIDTH);
    });
    ro.observe(el);
    setLaneWidth(el.clientWidth || FALLBACK_WIDTH);
    return () => ro.disconnect();
  }, []);
  const cols = Math.max(80, Math.round((laneWidth * zoom) / COL_PX));

  // При смене зума удерживаем в поле зрения место работы (выделение или
  // плейхед) — иначе после приближения таймлайн уезжает в начало записи.
  useEffect(() => {
    const el = lanesRef.current;
    if (!el || duration <= 0) return;
    const focus = selRef.current ? selRef.current.start : timeRef.current;
    const center = (focus / duration) * el.scrollWidth - el.clientWidth / 2;
    el.scrollLeft = Math.max(0, center);
    // Специально только по zoom: следить за временем здесь — значит драться
    // с пользовательской прокруткой на каждом кадре воспроизведения.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // Загрузка состояния редактора: дорожки, карты громкости, ссылки на аудио.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const st = await api.audioEditState(meeting.id);
        if (!alive) return;
        setTracks(st.tracks);
        setHasOriginal(st.has_original);
        const loaded = await Promise.all(
          st.tracks.map(
            async (t) =>
              [
                t,
                await api.waveform(meeting.id, t, BUCKETS),
                await api.trackUrl(meeting.id, t, version || undefined),
              ] as const,
          ),
        );
        if (!alive) return;
        const nextWaves: Partial<Record<TrackFile, Waveform>> = {};
        const nextUrls: Partial<Record<TrackFile, string>> = {};
        for (const [t, wf, url] of loaded) {
          nextWaves[t] = wf;
          nextUrls[t] = url;
        }
        setWaves(nextWaves);
        setUrls(nextUrls);
        // Ошибку здесь НЕ гасим: перезагрузка запускается и после неудачной
        // правки (вернуть дорожки в плеер) — баннер должен остаться.
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [meeting.id, version]);

  // ---- Воспроизведение ----
  const eachAudio = (fn: (el: HTMLAudioElement) => void) => {
    for (const el of Object.values(audioRefs.current)) if (el) fn(el);
  };

  const seek = useCallback((t: number) => {
    const clamped = Math.max(0, t);
    eachAudio((el) => {
      el.currentTime = clamped;
    });
    setTime(clamped);
  }, []);

  const pauseAll = useCallback(() => {
    eachAudio((el) => el.pause());
    setPlaying(false);
  }, []);

  /// Отпускает WAV-файлы перед их перезаписью: на Windows файл, открытый
  /// webview для проигрывания, может не дать себя заменить. Ссылки вернёт
  /// перезагрузка после правки (см. `version`).
  const detachAudio = () => {
    eachAudio((el) => {
      try {
        el.pause();
        el.removeAttribute("src");
        el.load();
      } catch {
        /* jsdom/старый webview — не критично */
      }
    });
    setPlaying(false);
  };

  const togglePlay = useCallback(() => {
    if (playing) {
      pauseAll();
      return;
    }
    // Из вырезанного места стартуем со следующего звучащего.
    if (skip) {
      const target = skipTarget(time, cuts);
      if (target !== null) seek(target);
    }
    eachAudio((el) => {
      void el.play().catch(() => {});
    });
    setPlaying(true);
  }, [playing, pauseAll, skip, time, cuts, seek]);

  const onTimeUpdate = (el: HTMLAudioElement) => {
    const t = el.currentTime;
    if (skip) {
      const target = skipTarget(t, cuts);
      if (target !== null) {
        if (target >= duration - 0.05) {
          pauseAll();
          seek(0);
          return;
        }
        seek(target);
        return;
      }
    }
    setTime(t);
  };

  // ---- Выделение и вырезы ----
  const timeAt = useCallback(
    (clientX: number): number => {
      const el = stageRef.current;
      if (!el || duration <= 0) return 0;
      const r = el.getBoundingClientRect();
      const width = r.width || FALLBACK_WIDTH;
      const ratio = (clientX - r.left) / width;
      return Math.max(0, Math.min(duration, ratio * duration));
    },
    [duration],
  );

  const cutSelection = useCallback(() => {
    if (!sel) return;
    setCuts([...cuts, sel]);
    setSel(null);
  }, [sel, cuts, setCuts]);

  const keepSelection = useCallback(() => {
    if (!sel) return;
    setCuts([...cuts, ...invertCuts(duration, sel)]);
    setSel(null);
  }, [sel, cuts, duration, setCuts]);

  const dropCut = (index: number) => {
    setCuts(cuts.filter((_, j) => j !== index));
  };

  const commitSel = (which: "start" | "end", text: string) => {
    setSelNonce((n) => n + 1);
    if (!sel) return;
    const v = parseClock(text);
    if (v === null) return;
    setSel(
      which === "start"
        ? normalizeCut(v, sel.end, duration)
        : normalizeCut(sel.start, v, duration),
    );
  };

  // Горячие клавиши редактора (не мешаем вводу в поля и диалогу).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (pending) return;
      if (e.code === "Space") {
        // Пробел — штатная активация кнопки под фокусом; не отбираем её.
        if (el?.tagName === "BUTTON") return;
        e.preventDefault();
        togglePlay();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (sel) {
          e.preventDefault();
          cutSelection();
        }
      } else if (e.key === "Escape") {
        setSel(null);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(Math.max(0, time - (e.shiftKey ? 5 : 1)));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(Math.min(duration, time + (e.shiftKey ? 5 : 1)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, togglePlay, sel, cutSelection, seek, time, duration]);

  // ---- Применение и возврат ----
  const doApply = async () => {
    setPending(null);
    setBusy(true);
    setError("");
    setNotice("");
    detachAudio();
    try {
      const m = await api.applyAudioEdit(meeting.id, toRanges(cuts));
      resetHist();
      setSel(null);
      pauseAll();
      setTime(0);
      setHasOriginal(true);
      setNotice(
        `Готово: в записи ${clock(m.duration_secs)}. Оригинал сохранён — правку можно отменить.`,
      );
      setVersion(Date.now());
      onApplied(m);
    } catch (e) {
      setError(String(e));
      setVersion(Date.now()); // правка не прошла — возвращаем дорожки в плеер
    } finally {
      setBusy(false);
    }
  };

  const doRevert = async () => {
    setPending(null);
    setBusy(true);
    setError("");
    setNotice("");
    detachAudio();
    try {
      const m = await api.revertAudioEdit(meeting.id);
      resetHist();
      setSel(null);
      pauseAll();
      setTime(0);
      setNotice(
        `Оригинал возвращён: ${clock(m.duration_secs)}. Если расшифровку делали после правок, обновите её («↻ Заново»).`,
      );
      setVersion(Date.now());
      onApplied(m);
    } catch (e) {
      setError(String(e));
      setVersion(Date.now());
    } finally {
      setBusy(false);
    }
  };

  // ---- Отрисовка ----
  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);
  const kept = keptDuration(duration, cuts);
  const removed = cutsTotal(cuts);
  // Секунды с десятыми читаются до минуты; дальше — как время на плеере.
  const removedLabel =
    removed >= 60 ? clock(removed) : `${removed.toFixed(1)} с`;
  const step = rulerStep(duration, zoom);
  const ticks = rulerTicks(duration, step);
  const dragRegion = drag ? normalizeCut(drag.from, drag.to, duration) : null;
  const shown = dragRegion ?? sel;
  const zoomIndex = ZOOMS.indexOf(zoom);
  const primary: TrackFile | undefined = tracks.includes("mic.wav")
    ? "mic.wav"
    : tracks[0];

  return (
    <div className="ae">
      <div className="ae-bar">
        <button className="btn ghost ae-back" onClick={onClose}>
          <IconBack /> К встрече
        </button>
        <h2 className="ae-title">Правка аудио</h2>
        <span className="ae-of" title={meeting.title}>
          {meeting.title || "Без названия"}
        </span>
        <div className="spacer" />
        {hasOriginal && (
          <span
            className="ae-orig"
            title="Исходная запись сохранена — правку аудио можно отменить"
          >
            <IconSaved /> Оригинал сохранён
          </span>
        )}
      </div>

      {error && (
        <div className="ai-error error-banner">
          <span>{error}</span>
          <CopyLogButton className="btn ghost" />
        </div>
      )}
      {notice && <p className="ae-notice">{notice}</p>}

      <div className="ae-tools">
        <button
          className="play-btn ae-play"
          onClick={togglePlay}
          disabled={loading || duration <= 0}
          aria-label={playing ? "Пауза" : "Играть"}
        >
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <span className="ae-clock">
          <b>{clockPrecise(time)}</b> / {clock(duration)}
        </span>

        <span className="ae-div" />

        <button
          className="btn primary"
          onClick={cutSelection}
          disabled={!sel || busy}
          title="Вырезать выделенный фрагмент (Delete)"
        >
          <IconScissors /> Вырезать
        </button>
        <button
          className="btn ghost"
          onClick={keepSelection}
          disabled={!sel || busy}
          title="Оставить только выделенное — обрезать всё остальное"
        >
          <IconKeep /> Оставить только это
        </button>

        <span className="ae-div" />

        <button
          className="btn ghost btn-sm"
          onClick={() => setHist((h) => ({ ...h, i: Math.max(0, h.i - 1) }))}
          disabled={hist.i === 0 || busy}
          title="Шаг назад"
          aria-label="Шаг назад"
        >
          <IconUndo />
        </button>
        <button
          className="btn ghost btn-sm"
          onClick={() =>
            setHist((h) => ({ ...h, i: Math.min(h.list.length - 1, h.i + 1) }))
          }
          disabled={hist.i >= hist.list.length - 1 || busy}
          title="Шаг вперёд"
          aria-label="Шаг вперёд"
        >
          <IconRedo />
        </button>
        <button
          className="btn ghost btn-sm"
          onClick={() => setCuts([])}
          disabled={cuts.length === 0 || busy}
          title="Убрать все вырезы"
        >
          Сбросить
        </button>

        <div className="spacer" />

        <span className="ae-skip">
          <button
            type="button"
            role="switch"
            aria-checked={skip}
            aria-label="Пропускать вырезы при прослушивании"
            className={skip ? "switch on" : "switch"}
            onClick={() => setSkip((v) => !v)}
          >
            <span className="switch-knob" />
          </button>
          Слушать без вырезов
        </span>

        <span className="ae-zoom">
          <button
            className="btn ghost btn-sm"
            onClick={() => setZoom(ZOOMS[Math.max(0, zoomIndex - 1)])}
            disabled={zoomIndex <= 0}
            title="Отдалить"
            aria-label="Отдалить"
          >
            <IconZoomOut />
          </button>
          <b>×{zoom}</b>
          <button
            className="btn ghost btn-sm"
            onClick={() =>
              setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIndex + 1)])
            }
            disabled={zoomIndex >= ZOOMS.length - 1}
            title="Приблизить"
            aria-label="Приблизить"
          >
            <IconZoomIn />
          </button>
        </span>
      </div>

      {sel && (
        <div className="ae-selbar">
          <span className="ae-selbar-label">Выделено</span>
          <input
            key={`s${selNonce}`}
            className="ae-time"
            defaultValue={clockPrecise(sel.start)}
            onBlur={(e) => commitSel("start", e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && commitSel("start", e.currentTarget.value)
            }
            aria-label="Начало выделения"
          />
          <span className="ae-dash">–</span>
          <input
            key={`e${selNonce}`}
            className="ae-time"
            defaultValue={clockPrecise(sel.end)}
            onBlur={(e) => commitSel("end", e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && commitSel("end", e.currentTarget.value)
            }
            aria-label="Конец выделения"
          />
          <span className="ae-sellen">
            {(sel.end - sel.start).toFixed(1)} с
          </span>
          <button className="btn ghost btn-sm" onClick={() => setSel(null)}>
            Снять
          </button>
        </div>
      )}

      <div className="ae-lanes" ref={lanesRef}>
        <div
          className="ae-stage"
          ref={stageRef}
          style={{ width: `${zoom * 100}%` }}
          onPointerDown={(e) => {
            if (e.button !== 0 || duration <= 0) return;
            const t = timeAt(e.clientX);
            setDrag({ from: t, to: t });
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag) return;
            const t = timeAt(e.clientX);
            setDrag((d) => (d ? { ...d, to: t } : d));
          }}
          onPointerUp={(e) => {
            if (!drag) return;
            const region = normalizeCut(drag.from, timeAt(e.clientX), duration);
            setDrag(null);
            if (region.end - region.start < MIN_CUT_SECS) {
              seek(region.start);
              setSel(null);
            } else {
              setSel(region);
              setSelNonce((n) => n + 1);
            }
          }}
        >
          <div className="ae-ruler">
            {ticks.map((t) => (
              <span
                key={t}
                className="ae-tick"
                style={{ left: `${pct(t)}%` }}
              >
                {clock(t)}
              </span>
            ))}
          </div>

          {tracks.length === 0 && !loading ? (
            <p className="ae-empty">У этой встречи нет аудиодорожек.</p>
          ) : (
            (tracks.length > 0 ? tracks : (["mic.wav"] as TrackFile[])).map(
              (t) => (
                <WaveLane
                  key={t}
                  name={laneName(t, meeting.id)}
                  peaks={waves[t]?.peaks ?? []}
                  rms={waves[t]?.rms ?? []}
                  cols={cols}
                  tone={laneTone(t)}
                  loading={loading}
                />
              ),
            )
          )}

          <div className="ae-overlay">
            {cuts.map((c, i) => (
              <div
                key={`${c.start}-${c.end}-${i}`}
                className="ae-cut"
                style={{ left: `${pct(c.start)}%`, width: `${pct(c.end - c.start)}%` }}
              >
                <button
                  className="ae-cut-x"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => dropCut(i)}
                  title="Убрать этот вырез"
                  aria-label={`Убрать вырез ${clockPrecise(c.start)} – ${clockPrecise(c.end)}`}
                >
                  <IconClose />
                </button>
              </div>
            ))}
            {shown && shown.end > shown.start && (
              <div
                className={drag ? "ae-sel ae-sel--drag" : "ae-sel"}
                style={{
                  left: `${pct(shown.start)}%`,
                  width: `${pct(shown.end - shown.start)}%`,
                }}
              />
            )}
            <div className="ae-playhead" style={{ left: `${pct(time)}%` }} />
          </div>
        </div>
      </div>

      <p className="ae-hint">
        Протяните по волне — выделите фрагмент. <kbd>Пробел</kbd> —
        воспроизведение, <kbd>Delete</kbd> — вырезать, <kbd>Esc</kbd> — снять
        выделение, <kbd>←</kbd>/<kbd>→</kbd> — на секунду (с Shift — на пять).
      </p>

      <div className="ae-foot">
        <span className="ae-sum">
          <span className="ae-was">{clock(duration)}</span>
          <IconArrowRight />
          <span className="ae-will">{clock(kept)}</span>
        </span>
        <span
          className={
            cuts.length > 0 ? "ae-cuts-count" : "ae-cuts-count ae-cuts-none"
          }
        >
          {cuts.length > 0
            ? `вырезов ${cuts.length} · ${removedLabel}`
            : "правок нет"}
        </span>
        <div className="spacer" />
        {hasOriginal && (
          <button
            className="btn ghost"
            onClick={() => setPending("revert")}
            disabled={busy}
            title="Вернуть исходное аудио и расшифровку"
          >
            <IconRestore /> Вернуть оригинал
          </button>
        )}
        <button
          className="btn primary"
          onClick={() => setPending("apply")}
          disabled={busy || cuts.length === 0}
        >
          {busy ? "Сохраняю…" : <><IconCheck /> Применить</>}
        </button>
      </div>

      {pending === "apply" && (
        <ConfirmDialog
          message={`Вырезать из записи ${cuts.length} ${cuts.length === 1 ? "фрагмент" : "фрагмента"} (${removedLabel})? Останется ${clock(kept)}. Оригинал сохранится — правку можно отменить.`}
          confirmLabel="Вырезать и сохранить"
          onConfirm={doApply}
          onCancel={() => setPending(null)}
        />
      )}
      {pending === "revert" && (
        <ConfirmDialog
          message="Вернуть исходное аудио и расшифровку? Все правки аудио этой встречи будут отменены."
          confirmLabel="Вернуть исходное аудио"
          onConfirm={doRevert}
          onCancel={() => setPending(null)}
        />
      )}

      {tracks.map((t) => (
        <audio
          key={t}
          ref={(el) => {
            audioRefs.current[t] = el;
          }}
          src={urls[t] || undefined}
          preload="metadata"
          onTimeUpdate={
            t === primary
              ? (e) => onTimeUpdate(e.currentTarget)
              : undefined
          }
          onEnded={t === primary ? () => setPlaying(false) : undefined}
        />
      ))}
    </div>
  );
}
