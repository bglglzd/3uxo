import type { Meeting } from "../types";

interface Props {
  meetings: Meeting[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MeetingList({ meetings, onSelect, onDelete }: Props) {
  if (meetings.length === 0) {
    return <p className="empty">Пока нет записей. Нажми «Начать запись».</p>;
  }
  return (
    <ul className="meeting-list">
      {meetings.map((m) => (
        <li key={m.id} className="meeting-row" onClick={() => onSelect(m.id)}>
          <div className="meeting-row-content">
            <div className="meeting-row-info">
              <span className="meeting-title">{m.title}</span>
              <span className="meeting-meta">
                {new Date(m.created_at).toLocaleString()} · {formatDuration(m.duration_secs)}
              </span>
            </div>
            <button
              className="delete-btn"
              aria-label="Удалить"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm("Удалить эту встречу?")) onDelete(m.id);
              }}
            >
              🗑
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
