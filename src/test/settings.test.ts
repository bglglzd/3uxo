import { describe, it, expect, beforeEach } from "vitest";
import { getSettings, saveSettings, isAiConfigured } from "../settings";

describe("settings", () => {
  beforeEach(() => localStorage.clear());

  it("returns defaults when empty", () => {
    const s = getSettings();
    expect(s.ai).toEqual({ base_url: "", api_key: "", model: "" });
    expect(s.whisper).toEqual({ whisperPath: "", model: "medium", language: "ru" });
  });

  it("round-trips saved settings", () => {
    saveSettings({
      ai: { base_url: "u", api_key: "k", model: "m" },
      whisper: { whisperPath: "p", model: "wm", language: "ru" },
    });
    const s = getSettings();
    expect(s.ai.base_url).toBe("u");
    expect(s.whisper.language).toBe("ru");
  });

  it("merges partial stored settings with defaults", () => {
    localStorage.setItem("3uxo.settings", JSON.stringify({ ai: { base_url: "x" } }));
    const s = getSettings();
    expect(s.ai.base_url).toBe("x");
    expect(s.ai.model).toBe("");
    expect(s.whisper.whisperPath).toBe("");
  });

  it("falls back to defaults on malformed storage", () => {
    localStorage.setItem("3uxo.settings", "not json");
    expect(getSettings().ai.base_url).toBe("");
  });

  it("isAiConfigured reflects completeness", () => {
    expect(
      isAiConfigured({
        ai: { base_url: "u", api_key: "k", model: "m" },
        whisper: { whisperPath: "", model: "", language: "" },
      }),
    ).toBe(true);
    expect(isAiConfigured(getSettings())).toBe(false);
  });
});
