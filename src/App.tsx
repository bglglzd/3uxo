import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import { getSettings } from "./settings";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showImport, setShowImport] = useState(false);
  // Боковая панель как выезжающее меню на узких экранах (телефон).
  const [navOpen, setNavOpen] = useState(false);
  // Состояние расшифровок по id — живёт на уровне приложения.
  const [trans, setTrans] = useState<Record<string, TranscribeState>>({});

  const refresh = useCallback(async () => {
    setMeetings(await api.listMeetings());
    setRecording(await api.isRecording());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    void checkForUpdates();
  }, []);

  // Таймер записи.
  useEffect(() => {
    if (!recording) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((p) => p + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

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
    async (id: string, speakerCount: number | null) => {
      setTrans((t) => ({ ...t, [id]: { running: true, percent: 0 } }));
      try {
        await api.transcribe(id, getSettings().whisper, speakerCount);
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
    await api.startRecording();
    setRecording(true);
  };

  const handleStop = async () => {
    const m = await api.stopRecording();
    setRecording(false);
    await refresh();
    if (m?.id) setSelectedId(m.id);
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
        elapsed={elapsed}
        progress={trans}
        open={navOpen}
        onStart={handleStart}
        onStop={handleStop}
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
            onTranscribe={(speakerCount) => startTranscription(selected.id, speakerCount)}
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
