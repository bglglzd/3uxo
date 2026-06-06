import { useMemo, useState } from "react";
import type { Meeting } from "../types";
import { RecordButton } from "./RecordButton";
import { MeetingList } from "./MeetingList";

interface Props {
  meetings: Meeting[];
  activeId: string | null;
  recording: boolean;
  elapsed: number;
  onStart: () => void;
  onStop: () => void;
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
