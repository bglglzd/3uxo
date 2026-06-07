import { useState } from "react";
import { getSettings, saveSettings } from "../settings";
import type { AppSettings } from "../types";
import { CopyLogButton } from "./CopyLogButton";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<AppSettings>(getSettings());

  const ai = (k: keyof AppSettings["ai"], v: string) =>
    setS({ ...s, ai: { ...s.ai, [k]: v } });
  const wh = (k: keyof AppSettings["whisper"], v: string) =>
    setS({ ...s, whisper: { ...s.whisper, [k]: v } });

  const save = () => {
    saveSettings(s);
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Настройки</h2>
        <p className="lead">
          ИИ и расшифровка работают с твоими локальными сервисами. Ничего не уходит
          наружу без твоего ключа.
        </p>

        <h4>Искусственный интеллект</h4>
        <div className="field">
          <label>Base URL</label>
          <input
            value={s.ai.base_url}
            onChange={(e) => ai("base_url", e.target.value)}
            placeholder="http://ai-pc.lan:18080/v1"
          />
        </div>
        <div className="field">
          <label>API-ключ</label>
          <input
            type="password"
            value={s.ai.api_key}
            onChange={(e) => ai("api_key", e.target.value)}
            placeholder="sk-no-key-required"
          />
          <span className="hint">
            Если ключ не нужен — впиши любой, напр. sk-no-key-required
          </span>
        </div>
        <div className="field">
          <label>Модель</label>
          <input
            value={s.ai.model}
            onChange={(e) => ai("model", e.target.value)}
            placeholder="qwen3.6-27b-q4"
          />
        </div>

        <h4>Whisper · расшифровка</h4>
        <p className="hint">
          Расшифровка идёт локально, внутри приложения. Нужную модель 3uxo
          скачает сам один раз при первой расшифровке — ставить ничего не нужно.
        </p>
        <div className="field">
          <label>Модель</label>
          <select
            value={s.whisper.model || "medium"}
            onChange={(e) => wh("model", e.target.value)}
          >
            <option value="base">base — быстрее всего, ~142 МБ</option>
            <option value="small">small — быстрее, ~466 МБ</option>
            <option value="medium">
              medium — точнее для русского, ~1.5 ГБ (рекомендуется)
            </option>
            <option value="large-v3">large-v3 — максимум качества, ~3 ГБ</option>
          </select>
          <span className="hint">
            Модель скачается один раз при первой расшифровке. Больше модель —
            точнее, но медленнее на CPU.
          </span>
        </div>
        <div className="field">
          <label>Язык</label>
          <input
            value={s.whisper.language}
            onChange={(e) => wh("language", e.target.value)}
            placeholder="ru"
          />
          <span className="hint">
            По умолчанию «ru». Впиши «auto» для автоопределения языка.
          </span>
        </div>
        <details className="adv">
          <summary>Использовать свой whisper (необязательно)</summary>
          <div className="field">
            <label>Путь к whisper-CLI</label>
            <input
              value={s.whisper.whisperPath}
              onChange={(e) => wh("whisperPath", e.target.value)}
              placeholder="напр. C:\\tools\\whisper-cli.exe"
            />
            <span className="hint">
              Если задано — используется он вместо встроенного движка.
            </span>
          </div>
        </details>

        <h4>Диагностика</h4>
        <p className="hint">
          Если что-то идёт не так — скопируй лог и пришли его. В нём версия,
          окружение и последние ошибки (без твоих ключей и текста разговоров).
        </p>
        <div className="btn-row">
          <CopyLogButton className="btn" />
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" onClick={save}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
