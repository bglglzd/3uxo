import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import { formatClock } from "./util";
import type { Meeting } from "./types";
import { RecordButton } from "./components/RecordButton";
import { MeetingList } from "./components/MeetingList";
import { MeetingDetail } from "./components/MeetingDetail";
import { SettingsPanel } from "./components/SettingsPanel";
import "./App.css";

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

  // Recording timer: tick every second while recording is active
  useEffect(() => {
    if (!recording) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  // Subscribe to backend recording-changed events (hotkey / tray)
  useEffect(() => {
    const un = listen("recording-changed", () => {
      refresh();
    });
    return () => {
      un.then((f) => f());
    };
  }, [refresh]);

  const handleStart = async () => {
    await api.startRecording();
    setRecording(true);
  };

  const handleStop = async () => {
    await api.stopRecording();
    setRecording(false);
    await refresh();
  };

  const handleDelete = async (id: string) => {
    await api.deleteMeeting(id);
    if (selectedId === id) setSelectedId(null);
    await refresh();
  };

  const selected = meetings.find((m) => m.id === selectedId) ?? null;

  return (
    <main className="app">
      <header className="app-header">
        <h1>3uxo · третье ухо</h1>
        <div className="header-actions">
          <RecordButton recording={recording} onStart={handleStart} onStop={handleStop} />
          {recording && <span className="rec-timer">{formatClock(elapsed)}</span>}
          <button className="settings-btn" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
      </header>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {selected ? (
        <MeetingDetail meeting={selected} onBack={() => setSelectedId(null)} onMetaSaved={refresh} />
      ) : (
        <MeetingList meetings={meetings} onSelect={setSelectedId} onDelete={handleDelete} />
      )}
    </main>
  );
}
