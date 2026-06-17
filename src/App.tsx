import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { getSettings } from "./settings";
import type { Meeting, TranscribeState } from "./types";
import { Sidebar } from "./components/Sidebar";
import { MeetingView } from "./components/MeetingView";
import { SettingsModal } from "./components/SettingsModal";
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
  const [importError, setImportError] = useState("");
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

  const handleImport = async () => {
    setImportError("");
    let selected: string | string[] | null = null;
    try {
      selected = await open({
        multiple: false,
        filters: [
          {
            name: "Аудио",
            extensions: [
              "m4a", "mp3", "wav", "flac", "ogg", "oga",
              "aac", "aif", "aiff", "caf", "mp4",
            ],
          },
        ],
      });
    } catch (e) {
      setImportError(String(e));
      return;
    }
    if (typeof selected !== "string") return; // отмена выбора файла
    try {
      const m = await api.importRecording(selected);
      await refresh();
      setSelectedId(m.id);
    } catch (e) {
      setImportError(String(e));
    }
  };

  const handleDelete = async (id: string) => {
    await api.deleteMeeting(id);
    if (selectedId === id) setSelectedId(null);
    await refresh();
  };

  const selected = meetings.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="app">
      <Sidebar
        meetings={meetings}
        activeId={selectedId}
        recording={recording}
        elapsed={elapsed}
        progress={trans}
        importError={importError}
        onStart={handleStart}
        onStop={handleStop}
        onImport={handleImport}
        onSelect={setSelectedId}
        onDelete={handleDelete}
        onOpenSettings={() => setShowSettings(true)}
      />

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
            <div className="ear">👂</div>
            <h2>Выбери встречу</h2>
            <p>
              Нажми «Начать запись», чтобы записать созвон,
              <br />
              или выбери встречу слева.
            </p>
          </div>
        )}
      </main>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
