import type { AiConfig } from "./types";

const KEY = "3uxo.ai";

export function getSettings(): AiConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as AiConfig;
  } catch {
    // ignore malformed storage
  }
  return { base_url: "", api_key: "", model: "" };
}

export function saveSettings(cfg: AiConfig): void {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}
