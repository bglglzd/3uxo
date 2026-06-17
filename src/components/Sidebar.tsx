import { useMemo, useState } from "react";
import type { Meeting, TranscribeState } from "../types";
import { RecordButton } from "./RecordButton";
import { MeetingList } from "./MeetingList";

interface Props {
  meetings: Meeting[];
  activeId: string | null;
  recording: boolean;
  elapsed: number;
  progress: Record<string, TranscribeState>;
  importError?: string;
  onStart: () => void;
  onStop: () => void;
  onImport: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
}

export function Sidebar(p: Props) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return p.meetings;
    return p.meetings.filter((m) =>
      `${m.title} ${m.participants} ${m.topic}`.toLowerCase().includes(needle),
    );
  }, [p.meetings, q]);

  return (
    <aside className="sidebar">
      <div className="brand">
        <b>3uxo</b>
        <span>третье ухо</span>
      </div>

      <RecordButton
        recording={p.recording}
        elapsed={p.elapsed}
        onStart={p.onStart}
        onStop={p.onStop}
      />

      <button className="import-btn" onClick={p.onImport}>
        📥 Импорт записи
      </button>
      {p.importError && <div className="ai-error">{p.importError}</div>}

      <div className="search">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск встреч"
        />
      </div>

      <div className="meetings">
        <div className="section-label">Встречи</div>
        <MeetingList
          meetings={filtered}
          activeId={p.activeId}
          progress={p.progress}
          onSelect={p.onSelect}
          onDelete={p.onDelete}
        />
      </div>

      <button className="settings-trigger" onClick={p.onOpenSettings}>
        ⚙ Настройки
      </button>
    </aside>
  );
}
