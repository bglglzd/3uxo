import type { AppSettings } from "./types";

const KEY = "3uxo.settings";

/// Модель распознавания по умолчанию: large-v3-turbo (8 бит) — точность
/// уровня large-v3 для русского при размере и скорости лучше medium.
export const DEFAULT_WHISPER_MODEL = "large-v3-turbo-q8_0";

/// Версия схемы настроек. 2 — v0.8: новая модель по умолчанию + aiAuto.
const VERSION = 2;

const DEFAULTS: AppSettings = {
  ai: { base_url: "", api_key: "", model: "" },
  whisper: { whisperPath: "", model: DEFAULT_WHISPER_MODEL, language: "ru" },
  hotkey: "Ctrl+Shift+R",
  autoRecord: {
    enabled: false,
    apps: [],
    autoStop: true,
    startDelaySecs: 5,
    minKeepSecs: 12,
  },
  aiAuto: { title: true, summary: true },
};

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const whisper = { ...DEFAULTS.whisper, ...(parsed.whisper ?? {}) };
      // До v0.8 модель по умолчанию была medium и сохранялась в настройки —
      // переводим на новую (лучше и быстрее). Явный выбор после v0.8 не трогаем.
      if ((parsed.version ?? 1) < 2 && (!whisper.model || whisper.model === "medium")) {
        whisper.model = DEFAULT_WHISPER_MODEL;
      }
      return {
        ai: { ...DEFAULTS.ai, ...(parsed.ai ?? {}) },
        whisper,
        hotkey: typeof parsed.hotkey === "string" ? parsed.hotkey : DEFAULTS.hotkey,
        autoRecord: { ...DEFAULTS.autoRecord, ...(parsed.autoRecord ?? {}) },
        aiAuto: { ...DEFAULTS.aiAuto, ...(parsed.aiAuto ?? {}) },
      };
    }
  } catch {
    // malformed storage → defaults
  }
  return DEFAULTS;
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify({ ...settings, version: VERSION }));
}

/// true, если ИИ настроен достаточно для запросов.
export function isAiConfigured(s: AppSettings): boolean {
  return !!(s.ai.base_url && s.ai.api_key && s.ai.model);
}
