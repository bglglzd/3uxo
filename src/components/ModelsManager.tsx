import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ModelInfo } from "../types";
import { api } from "../api";

/// Описание моделей распознавания для выбора.
export const WHISPER_CHOICES: { id: string; title: string; note: string }[] = [
  {
    id: "parakeet-tdt-0.6b-v3",
    title: "Parakeet v3 · NVIDIA",
    note: "Рекомендуется: точный русский с пунктуацией, в разы быстрее, без видеокарты. 25 европейских языков · ~0.5 ГБ",
  },
  {
    id: "large-v3-turbo-q8_0",
    title: "Whisper Large v3 Turbo",
    note: "Почти любой язык мира; быстро с видеокартой · ~0.9 ГБ",
  },
  { id: "large-v3-turbo", title: "Whisper Large v3 Turbo (полная)", note: "То же без сжатия, ~1.6 ГБ" },
  { id: "large-v3", title: "Whisper Large v3", note: "Максимум качества, медленно без видеокарты, ~3.1 ГБ" },
  { id: "medium", title: "Whisper Medium", note: "Прежняя модель по умолчанию, ~1.5 ГБ" },
  { id: "small", title: "Whisper Small", note: "Для слабых компьютеров, ~0.5 ГБ" },
  { id: "base", title: "Whisper Base", note: "Черновая, очень быстро, ~0.15 ГБ" },
];

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} ГБ`;
  return `${Math.max(1, Math.round(n / 1e6))} МБ`;
}

interface Props {
  /// Выбранная модель распознавания.
  selected: string;
  onSelect: (id: string) => void;
}

/// Модели: какая выбрана, что скачано, скачать заранее, удалить лишнее.
/// Модели качаются один раз и дальше работают офлайн.
export function ModelsManager({ selected, onSelect }: Props) {
  const [status, setStatus] = useState<ModelInfo[] | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState("");

  const reload = () => api.modelsStatus().then(setStatus).catch(() => setStatus(null));

  useEffect(() => {
    void reload();
    const un = listen<{ id: string; percent: number }>("model-download-progress", (e) =>
      setProgress((p) => ({ ...p, [e.payload.id]: e.payload.percent })),
    );
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  }, []);

  const info = (id: string) => status?.find((m) => m.id === id);
  const downloading = (id: string) => progress[id] !== undefined;

  const download = async (id: string) => {
    setError("");
    setProgress((p) => ({ ...p, [id]: 0 }));
    try {
      await api.downloadModel(id);
    } catch (e) {
      setError(String(e));
    } finally {
      setProgress((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
      void reload();
    }
  };

  const remove = async (id: string) => {
    setError("");
    try {
      await api.deleteModel(id);
    } catch (e) {
      setError(String(e));
    }
    void reload();
  };

  const action = (id: string, canDelete: boolean) => {
    const m = info(id);
    if (downloading(id)) {
      return (
        <span className="model-progress">
          <span className="progress small">
            <span className="progress-bar" style={{ width: `${progress[id]}%` }} />
          </span>
          {Math.round(progress[id])}%
        </span>
      );
    }
    if (!m) return null;
    if (m.installed) {
      return (
        <span className="model-actions">
          <span className="model-ok">✓ скачана · {formatBytes(m.bytes)}</span>
          {canDelete && (
            <button type="button" className="btn ghost small" onClick={() => remove(id)}>
              Удалить
            </button>
          )}
        </span>
      );
    }
    return (
      <button type="button" className="btn small" onClick={() => download(id)}>
        Скачать · {formatBytes(m.bytes)}
      </button>
    );
  };

  const voices = info("voices");

  return (
    <div className="models">
      <div className="model-list" role="radiogroup" aria-label="Модель распознавания">
        {WHISPER_CHOICES.map((c) => (
          <label key={c.id} className={selected === c.id ? "model-row on" : "model-row"}>
            <input
              type="radio"
              name="whisper-model"
              checked={selected === c.id}
              onChange={() => onSelect(c.id)}
            />
            <span className="model-text">
              <span className="model-title">{c.title}</span>
              <span className="hint">{c.note}</span>
            </span>
            {action(c.id, selected !== c.id)}
          </label>
        ))}
      </div>
      <div className="model-row voices-model">
        <span className="model-text">
          <span className="model-title">Разделение голосов</span>
          <span className="hint">pyannote + wespeaker · ~33 МБ · нужно для «кто говорит»</span>
        </span>
        {voices && action("voices", false)}
      </div>
      {status === null && (
        <p className="hint">Статус моделей доступен в приложении (не в браузерном превью).</p>
      )}
      {error && <div className="ai-error">{error}</div>}
    </div>
  );
}
