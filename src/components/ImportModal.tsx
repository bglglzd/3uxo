import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api } from "../api";

interface Props {
  onClose: () => void;
  onImported: (meetingId: string) => void;
}

const AUDIO_EXTS = [
  "m4a", "mp3", "wav", "flac", "ogg", "oga", "opus",
  "aac", "aif", "aiff", "caf", "mp4",
];

function isAudioPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXTS.includes(ext);
}

/// Импорт записи: перетащи файл в поле или выбери через диалог.
export function ImportModal({ onClose, onImported }: Props) {
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  const doImport = async (path: string) => {
    if (!isAudioPath(path)) {
      setError("Это не аудиофайл. Поддерживаются: m4a, mp3, wav, flac, ogg, opus и др.");
      return;
    }
    setError("");
    setImporting(true);
    try {
      const m = await api.importRecording(path);
      onImported(m.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  };

  const browse = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Аудио", extensions: AUDIO_EXTS }],
      });
      if (typeof selected === "string") void doImport(selected);
    } catch (e) {
      setError(String(e));
    }
  };

  // Нативный drag-and-drop из ОС (Tauri перехватывает системные перетаскивания).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    try {
      getCurrentWebview()
        .onDragDropEvent((event) => {
          const p = event.payload;
          if (p.type === "over" || p.type === "enter") {
            setDragging(true);
          } else if (p.type === "leave") {
            setDragging(false);
          } else if (p.type === "drop") {
            setDragging(false);
            const path = p.paths?.[0];
            if (path) void doImport(path);
          }
        })
        .then((f) => {
          unlisten = f;
        })
        .catch(() => {});
    } catch {
      // Не в среде Tauri (например, браузерный превью) — drag-and-drop недоступен.
    }
    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Импорт записи</h2>
        <p className="lead">
          Перетащи аудиофайл в поле ниже или выбери его на диске.
        </p>

        <div className={dragging ? "dropzone over" : "dropzone"}>
          {importing ? (
            <div className="dz-inner">
              <span className="spin">◜</span>
              <span>Импортируем и декодируем…</span>
            </div>
          ) : (
            <div className="dz-inner">
              <div className="dz-icon">⬇</div>
              <div className="dz-title">
                {dragging ? "Отпусти файл здесь" : "Перетащи файл сюда"}
              </div>
              <button className="btn primary" onClick={browse} disabled={importing}>
                Выбрать файл
              </button>
              <div className="dz-hint">
                m4a · mp3 · wav · flac · ogg · opus и другие
              </div>
            </div>
          )}
        </div>

        {error && <div className="ai-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={importing}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
