import { useMemo, useState } from "react";
import type { Meeting, TranscribeState } from "../types";
import { getTheme, setTheme, type Theme } from "../theme";
import { RecordButton } from "./RecordButton";
import { MeetingList } from "./MeetingList";

interface Props {
  meetings: Meeting[];
  activeId: string | null;
  recording: boolean;
  elapsed: number;
  progress: Record<string, TranscribeState>;
  open?: boolean;
  onStart: () => void;
  onStop: () => void;
  onImport: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
}

export function Sidebar(p: Props) {
  const [q, setQ] = useState("");
  const [theme, setThemeState] = useState<Theme>(() => getTheme());

  const pickTheme = (t: Theme) => {
    setTheme(t);
    setThemeState(t);
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return p.meetings;
    return p.meetings.filter((m) =>
      `${m.title} ${m.participants} ${m.topic}`.toLowerCase().includes(needle),
    );
  }, [p.meetings, q]);

  return (
    <aside className={p.open ? "sidebar open" : "sidebar"}>
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

      <div className="sidebar-footer">
        <div className="theme-switch" role="group" aria-label="Тема оформления">
          <button
            className={theme === "light" ? "active" : ""}
            onClick={() => pickTheme("light")}
          >
            ☀ Светлая
          </button>
          <button
            className={theme === "dark" ? "active" : ""}
            onClick={() => pickTheme("dark")}
          >
            🌙 Тёмная
          </button>
        </div>
        <button className="settings-trigger" onClick={p.onOpenSettings}>
          ⚙ Настройки
        </button>
      </div>
    </aside>
  );
}
