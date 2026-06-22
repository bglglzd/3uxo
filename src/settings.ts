import type { AppSettings } from "./types";

const KEY = "3uxo.settings";

const DEFAULTS: AppSettings = {
  ai: { base_url: "", api_key: "", model: "" },
  whisper: { whisperPath: "", model: "medium", language: "ru" },
  hotkey: "Ctrl+Shift+R",
  autoRecord: {
    enabled: false,
    apps: [],
    autoStop: true,
    startDelaySecs: 5,
    minKeepSecs: 12,
  },
  fixEverywhere: true,
};

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ai: { ...DEFAULTS.ai, ...(parsed.ai ?? {}) },
        whisper: { ...DEFAULTS.whisper, ...(parsed.whisper ?? {}) },
        hotkey: typeof parsed.hotkey === "string" ? parsed.hotkey : DEFAULTS.hotkey,
        autoRecord: { ...DEFAULTS.autoRecord, ...(parsed.autoRecord ?? {}) },
        fixEverywhere:
          typeof parsed.fixEverywhere === "boolean"
            ? parsed.fixEverywhere
            : DEFAULTS.fixEverywhere,
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
