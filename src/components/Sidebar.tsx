import { useMemo, useState } from "react";
import type { Meeting, TranscribeState } from "../types";
import { getTheme, setTheme, type Theme } from "../theme";
import { RecordButton } from "./RecordButton";
import { MeetingList } from "./MeetingList";
import { AurisMark } from "./AurisMark";

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
        <AurisMark size={30} />
        <div className="brand-lockup">
          <span className="brand-word">auris</span>
          <span className="brand-divider" />
          <span className="brand-desc">
            ваше
            <br />
            третье ухо
          </span>
        </div>
      </div>

      <RecordButton
        recording={p.recording}
        elapsed={p.elapsed}
        onStart={p.onStart}
        onStop={p.onStop}
      />

      <button className="import-btn" onClick={p.onImport}>
        <svg
          className="btn-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v11" />
          <path d="m8 10.5 4 4 4-4" />
          <path d="M5 20h14" />
        </svg>
        Импорт записи
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
        <div className="privacy-note">
          <svg
            className="pn-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          <span>Работает локально · открытый код</span>
        </div>
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
