import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Meeting, TranscribeState } from "../types";
import { formatClock } from "../util";
import { ConfirmDialog } from "./ConfirmDialog";
import { MeetingEditDialog } from "./MeetingEditDialog";
import type { MeetingPatch } from "./MeetingEditDialog";

interface Props {
  meetings: Meeting[];
  activeId?: string | null;
  progress?: Record<string, TranscribeState>;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  /// Сохранить правку встречи из меню «⋯» (название, участники, тема, заметки).
  onEdit?: (id: string, patch: MeetingPatch) => void | Promise<void>;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
  });
}

/// Первая строка заметки — подсказка в списке.
function notePreview(notes?: string): string {
  const line = (notes ?? "").split("\n").find((l) => l.trim()) ?? "";
  return line.trim();
}

export function MeetingList({
  meetings,
  activeId,
  progress,
  onSelect,
  onDelete,
  onEdit,
}: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; focus: "title" | "notes" } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Меню закрывается кликом мимо и по Esc.
  useEffect(() => {
    if (!menuId) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuId(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuId]);

  if (meetings.length === 0) {
    return <p className="section-label">Пока нет записей</p>;
  }
  const editing = edit ? meetings.find((m) => m.id === edit.id) : undefined;

  return (
    <>
      {meetings.map((m) => {
        const tr = progress?.[m.id];
        const note = notePreview(m.notes);
        return (
          <div key={m.id} className={menuId === m.id ? "m-row menu-open" : "m-row"}>
            <button
              className={m.id === activeId ? "m-item active" : "m-item"}
              onClick={() => onSelect(m.id)}
              title={m.notes?.trim() ? m.notes : undefined}
            >
              <span className="m-title">{m.title}</span>
              <span className="m-sub">
                {tr?.running ? (
                  <span className="m-badge">● расшифровка {tr.percent}%</span>
                ) : (
                  <>
                    {shortDate(m.created_at)} · {formatClock(m.duration_secs)}
                  </>
                )}
              </span>
              {note && <span className="m-note">{note}</span>}
            </button>
            <button
              type="button"
              className="m-more"
              aria-label="Действия со встречей"
              aria-haspopup="menu"
              aria-expanded={menuId === m.id}
              title="Переименовать, заметки, удалить"
              onClick={() => setMenuId(menuId === m.id ? null : m.id)}
            >
              ⋯
            </button>
            {menuId === m.id && (
              <div className="m-menu" role="menu" ref={menuRef}>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuId(null);
                    setEdit({ id: m.id, focus: "title" });
                  }}
                >
                  ✎ Переименовать
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuId(null);
                    setEdit({ id: m.id, focus: "notes" });
                  }}
                >
                  🗒 Заметки и детали
                </button>
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setMenuId(null);
                    setConfirmId(m.id);
                  }}
                >
                  🗑 Удалить встречу
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Окна — порталом в body: у сайдбара backdrop-filter, и position:fixed
          внутри него позиционировался бы относительно сайдбара, а не окна. */}
      {editing && edit && createPortal(
        <MeetingEditDialog
          meeting={editing}
          focus={edit.focus}
          onCancel={() => setEdit(null)}
          onSave={async (patch) => {
            await onEdit?.(editing.id, patch);
            setEdit(null);
          }}
        />,
        document.body,
      )}

      {confirmId && createPortal(
        <ConfirmDialog
          message="Удалить эту встречу? Запись и расшифровка будут стёрты безвозвратно."
          onConfirm={() => {
            onDelete(confirmId);
            setConfirmId(null);
          }}
          onCancel={() => setConfirmId(null)}
        />,
        document.body,
      )}
    </>
  );
}
