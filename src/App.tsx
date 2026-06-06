import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import type { Meeting } from "./types";
import { Sidebar } from "./components/Sidebar";
import { MeetingView } from "./components/MeetingView";
import { SettingsModal } from "./components/SettingsModal";
import { checkForUpdates } from "./updater";

export default function App() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [recording, setRecording] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const refresh = useCallback(async () => {
    setMeetings(await api.listMeetings());
    setRecording(await api.isRecording());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Проверка обновлений при запуске (тихо).
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
        onStart={handleStart}
        onStop={handleStop}
        onSelect={setSelectedId}
        onDelete={handleDelete}
        onOpenSettings={() => setShowSettings(true)}
      />

      <main className="content">
        {selected ? (
          <MeetingView key={selected.id} meeting={selected} onMetaSaved={refresh} />
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
