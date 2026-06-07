import type { Meeting, TranscribeState } from "../types";
import { formatClock } from "../util";

interface Props {
  meetings: Meeting[];
  activeId?: string | null;
  progress?: Record<string, TranscribeState>;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
  });
}

export function MeetingList({
  meetings,
  activeId,
  progress,
  onSelect,
  onDelete,
}: Props) {
  if (meetings.length === 0) {
    return <p className="section-label">Пока нет записей</p>;
  }
  return (
    <>
      {meetings.map((m) => {
        const tr = progress?.[m.id];
        return (
          <button
            key={m.id}
            className={m.id === activeId ? "m-item active" : "m-item"}
            onClick={() => onSelect(m.id)}
          >
            <span className="m-title">{m.title}</span>
            <span
              className="m-del"
              role="button"
              aria-label="Удалить"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm("Удалить эту встречу?")) onDelete(m.id);
              }}
            >
              🗑
            </span>
            <span className="m-sub">
              {tr?.running ? (
                <span className="m-badge">● расшифровка {tr.percent}%</span>
              ) : (
                <>
                  {shortDate(m.created_at)} · {formatClock(m.duration_secs)}
                </>
              )}
            </span>
          </button>
        );
      })}
    </>
  );
}
