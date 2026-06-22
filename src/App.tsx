import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import { getSettings } from "./settings";
import { resolveProcesses } from "./autorecord";
import type { Meeting, TranscribeState } from "./types";
import { Sidebar } from "./components/Sidebar";
import { AurisMark } from "./components/AurisMark";
import { MeetingView } from "./components/MeetingView";
import { SettingsModal } from "./components/SettingsModal";
import { ImportModal } from "./components/ImportModal";
import { checkForUpdates } from "./updater";

type ProgressEvent = {
  id: string;
  stage: string;
  percent: number;
  done: number;
  total: number;
};

export default function App() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showImport, setShowImport] = useState(false);
  // Боковая панель как выезжающее меню на узких экранах (телефон).
  const [navOpen, setNavOpen] = useState(false);
  // Соло-режим «я один»: запоминаем выбор между сессиями.
  const [solo, setSolo] = useState(
    () => localStorage.getItem("3uxo.solo.pref") === "1",
  );
  // Состояние расшифровок по id — живёт на уровне приложения.
  const [trans, setTrans] = useState<Record<string, TranscribeState>>({});

  const refresh = useCallback(async () => {
    setMeetings(await api.listMeetings());
    const st = await api.recordingState();
    setRecording(st.recording);
    setPaused(st.paused);
  }, []);

  const changeSolo = useCallback((v: boolean) => {
    setSolo(v);
    localStorage.setItem("3uxo.solo.pref", v ? "1" : "0");
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    void checkForUpdates();
  }, []);

  // При запуске применяем сохранённые настройки записи: горячую клавишу
  // (бэкенд по умолчанию ставит Ctrl+Shift+R) и конфиг авто-записи звонков.
  useEffect(() => {
    const s = getSettings();
    api.updateHotkey(s.hotkey).catch(() => {});
    api
      .setAutorecord(
        s.autoRecord.enabled,
        resolveProcesses(s.autoRecord.apps),
        s.autoRecord.autoStop,
        s.autoRecord.startDelaySecs,
        s.autoRecord.minKeepSecs,
      )
      .catch(() => {});
  }, []);

  // Сброс таймера при старте новой записи (false → true).
  useEffect(() => {
    if (recording) setElapsed(0);
  }, [recording]);

  // Таймер записи: тикает, пока идёт запись и она не на паузе.
  useEffect(() => {
    if (!recording || paused) return;
    const id = setInterval(() => setElapsed((p) => p + 1), 1000);
    return () => clearInterval(id);
  }, [recording, paused]);

  // События старта/стопа по горячей клавише / трею.
  useEffect(() => {
    const un = listen("recording-changed", () => refresh());
    return () => {
      un.then((f) => f());
    };
  }, [refresh]);

  // Прогресс расшифровки из бэкенда. mic → 0–50%, system → 50–100%.
  useEffect(() => {
    const un = listen<ProgressEvent>("transcribe-progress", (e) => {
      const { id, stage, percent, done, total } = e.payload;
      setTrans((t) => ({
        ...t,
        [id]: { ...t[id], running: true, percent, stage, done, total, error: undefined },
      }));
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const startTranscription = useCallback(
    async (id: string, speakerCount: number | null, soloFlag: boolean) => {
      setTrans((t) => ({ ...t, [id]: { running: true, percent: 0 } }));
      try {
        await api.transcribe(id, getSettings().whisper, speakerCount, soloFlag);
        setTrans((t) => ({
          ...t,
          [id]: { running: false, percent: 100, doneToken: (t[id]?.doneToken ?? 0) + 1 },
        }));
        await refresh();
      } catch (e) {
        setTrans((t) => ({
          ...t,
          [id]: { running: false, percent: 0, error: String(e) },
        }));
      }
    },
    [refresh],
  );

  const handleStart = async () => {
    try {
      const id = await api.startRecording();
      // Помечаем встречу как соло, если включён режим «я один» (фронт читает это
      // при расшифровке — ключ в стиле 3uxo.speakers.*/3uxo.labels.*).
      if (solo && id) localStorage.setItem(`3uxo.solo.${id}`, "1");
      setRecording(true);
      setPaused(false);
    } catch {
      // Не оставляем UI в неопределённом состоянии — сверяемся с бэкендом.
      await refresh();
    }
  };

  // Остановка ОБЯЗАНА завершиться в UI, даже если бэкенд вернул ошибку: иначе
  // кнопка «стоп» залипает и кажется, что запись продолжается. Состояние всегда
  // синхронизируем с бэкендом (recording_state) в finally.
  const handleStop = async () => {
    let stopped: Meeting | null = null;
    try {
      stopped = await api.stopRecording();
    } catch {
      // ошибка уже залогирована в диагностику (api.inv) — продолжаем сброс UI
    } finally {
      setRecording(false);
      setPaused(false);
      await refresh();
    }
    if (stopped?.id) setSelectedId(stopped.id);
  };

  const handlePause = async () => {
    try {
      await api.pauseRecording();
      setPaused(true);
    } catch {
      await refresh();
    }
  };

  const handleResume = async () => {
    try {
      await api.resumeRecording();
      setPaused(false);
    } catch {
      await refresh();
    }
  };

  const handleImported = async (id: string) => {
    await refresh();
    setSelectedId(id);
    setShowImport(false);
  };

  const handleDelete = async (id: string) => {
    await api.deleteMeeting(id);
    if (selectedId === id) setSelectedId(null);
    await refresh();
  };

  const selected = meetings.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="app">
      <button
        className="nav-toggle"
        aria-label={navOpen ? "Закрыть меню" : "Меню"}
        onClick={() => setNavOpen((v) => !v)}
      >
        {navOpen ? "✕" : "☰"}
      </button>

      <Sidebar
        meetings={meetings}
        activeId={selectedId}
        recording={recording}
        paused={paused}
        elapsed={elapsed}
        solo={solo}
        progress={trans}
        open={navOpen}
        onStart={handleStart}
        onStop={handleStop}
        onPause={handlePause}
        onResume={handleResume}
        onSoloChange={changeSolo}
        onImport={() => {
          setNavOpen(false);
          setShowImport(true);
        }}
        onSelect={(id) => {
          setSelectedId(id);
          setNavOpen(false);
        }}
        onDelete={handleDelete}
        onOpenSettings={() => {
          setNavOpen(false);
          setShowSettings(true);
        }}
      />
      {navOpen && (
        <div className="nav-backdrop" onClick={() => setNavOpen(false)} />
      )}

      <main className="content">
        {selected ? (
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
          <div className="empty">
            <div className="empty-mark">
              <span className="ripple-ring" />
              <span className="ripple-ring d1" />
              <span className="ripple-ring d2" />
              <AurisMark size={90} />
            </div>
            <h2>Выбери встречу</h2>
            <p>
              Нажми «Начать запись», чтобы записать созвон, или выбери встречу
              слева.
            </p>
            <div className="privacy-card">
              <svg
                className="privacy-shield"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3 4 6v5c0 5 3.4 8 8 10 4.6-2 8-5 8-10V6l-8-3Z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              <div className="privacy-card-text">
                <strong>Приватно по умолчанию</strong>
                <p>
                  Запись, расшифровка и разделение голосов выполняются{" "}
                  <b>локально на вашем устройстве</b> — аудио и тексты никуда не
                  загружаются. ИИ-функции (резюме, анализ) — по желанию и через
                  ваш ключ. Открытый код.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={handleImported}
        />
      )}
    </div>
  );
}
