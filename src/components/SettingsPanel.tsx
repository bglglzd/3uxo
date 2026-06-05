import { useState } from "react";
import { getSettings, saveSettings } from "../settings";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState(getSettings());
  const save = () => {
    saveSettings(cfg);
    onClose();
  };
  return (
    <div className="settings-panel">
      <h2>Настройки ИИ</h2>
      <label>
        Base URL
        <input
          value={cfg.base_url}
          onChange={(e) => setCfg({ ...cfg, base_url: e.target.value })}
          placeholder="https://api.openai.com/v1"
        />
      </label>
      <label>
        API-ключ
        <input
          type="password"
          value={cfg.api_key}
          onChange={(e) => setCfg({ ...cfg, api_key: e.target.value })}
        />
      </label>
      <label>
        Модель
        <input
          value={cfg.model}
          onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
          placeholder="gpt-4o-mini"
        />
      </label>
      <div className="ai-actions">
        <button onClick={save}>Сохранить</button>
        <button onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}
