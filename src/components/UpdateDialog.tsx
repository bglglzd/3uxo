import { useState } from "react";
import type { UpdateInfo } from "../updater";
import { installUpdate } from "../updater";
import { Markdown } from "./Markdown";

interface Props {
  info: UpdateInfo;
  /// Идёт запись — перезапуск её оборвёт, поэтому обновление ждёт.
  recording: boolean;
  onLater: () => void;
}

/// «Доступна новая версия»: что нового + «Обновить и перезапустить». После
/// согласия всё автоматически: скачивание, установка, перезапуск.
export function UpdateDialog({ info, recording, onLater }: Props) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const installing = progress !== null;

  const install = async () => {
    setError("");
    setProgress(0);
    try {
      await installUpdate(info, setProgress);
    } catch (e) {
      setProgress(null);
      setError(`Не получилось обновиться: ${String(e)}`);
    }
  };

  return (
    <div className="overlay" onClick={installing ? undefined : onLater}>
      <div className="modal update-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Доступно обновление</h2>
        <p className="lead">
          Auris {info.version} · у вас {info.currentVersion}
        </p>
        {info.notes.trim() && (
          <div className="update-notes">
            <Markdown>{info.notes}</Markdown>
          </div>
        )}
        {recording && !installing && (
          <p className="hint">
            Сейчас идёт запись — обновление перезапустит приложение. Остановите
            запись, затем обновитесь.
          </p>
        )}
        {installing && (
          <div className="update-progress">
            <div className="progress">
              <div
                className="progress-bar"
                style={{ width: `${progress! < 0 ? 100 : progress}%` }}
              />
            </div>
            <span className="hint">
              {progress! >= 100
                ? "Устанавливаю и перезапускаю…"
                : progress! < 0
                  ? "Скачиваю…"
                  : `Скачиваю… ${Math.round(progress!)}%`}
            </span>
          </div>
        )}
        {error && <div className="ai-error">{error}</div>}
        <div className="modal-actions">
          <span className="hint">Записи и настройки сохранятся.</span>
          <div className="modal-actions-btns">
            <button className="btn ghost" onClick={onLater} disabled={installing}>
              Позже
            </button>
            <button
              className="btn primary"
              onClick={install}
              disabled={installing || recording}
            >
              Обновить и перезапустить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
