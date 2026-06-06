import { useState } from "react";
import { getSettings, saveSettings } from "../settings";
import type { AppSettings } from "../types";

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
          По умолчанию 3uxo сам находит установленный whisper. Поля ниже — только
          если нужно указать вручную.
        </p>
        <details className="adv">
          <summary>Дополнительно</summary>
          <div className="field">
            <label>Путь к whisper (необязательно)</label>
            <input
              value={s.whisper.whisperPath}
              onChange={(e) => wh("whisperPath", e.target.value)}
              placeholder="напр. C:\\tools\\whisper-cli.exe"
            />
          </div>
          <div className="field">
            <label>Модель</label>
            <input
              value={s.whisper.model}
              onChange={(e) => wh("model", e.target.value)}
              placeholder="напр. small или путь к ggml-модели"
            />
          </div>
          <div className="field">
            <label>Язык</label>
            <input
              value={s.whisper.language}
              onChange={(e) => wh("language", e.target.value)}
              placeholder="ru"
            />
          </div>
        </details>

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
