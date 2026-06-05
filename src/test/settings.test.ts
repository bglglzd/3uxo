import { describe, it, expect, beforeEach } from "vitest";
import { getSettings, saveSettings } from "../settings";

describe("settings", () => {
  beforeEach(() => localStorage.clear());

  it("returns empty config by default", () => {
    expect(getSettings()).toEqual({ base_url: "", api_key: "", model: "" });
  });

  it("round-trips saved config", () => {
    saveSettings({ base_url: "u", api_key: "k", model: "m" });
    expect(getSettings()).toEqual({ base_url: "u", api_key: "k", model: "m" });
  });

  it("falls back to empty on malformed storage", () => {
    localStorage.setItem("3uxo.ai", "not json");
    expect(getSettings()).toEqual({ base_url: "", api_key: "", model: "" });
  });
});
