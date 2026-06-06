import type { AppSettings } from "./types";

const KEY = "3uxo.settings";

const DEFAULTS: AppSettings = {
  ai: { base_url: "", api_key: "", model: "" },
  whisper: { whisperPath: "", model: "", language: "ru" },
};

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ai: { ...DEFAULTS.ai, ...(parsed.ai ?? {}) },
        whisper: { ...DEFAULTS.whisper, ...(parsed.whisper ?? {}) },
      };
    }
  } catch {
    // malformed storage → defaults
  }
  return DEFAULTS;
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

/// true, если ИИ настроен достаточно для запросов.
export function isAiConfigured(s: AppSettings): boolean {
  return !!(s.ai.base_url && s.ai.api_key && s.ai.model);
}
