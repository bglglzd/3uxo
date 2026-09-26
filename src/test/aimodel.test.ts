import { describe, it, expect, vi, beforeEach } from "vitest";

const { aiCheck } = vi.hoisted(() => ({ aiCheck: vi.fn() }));
vi.mock("../api", () => ({ api: { aiCheck } }));

import { syncServerModel, AI_MODEL_EVENT } from "../aimodel";
import { getSettings, saveSettings } from "../settings";

const base = () => ({
  ...getSettings(),
  ai: { base_url: "https://gardar.org/v1", api_key: "k", model: "qwen3.5-27b" },
});

describe("syncServerModel", () => {
  beforeEach(() => {
    localStorage.clear();
    aiCheck.mockReset();
  });

  it("switches to the updated server model and notifies", async () => {
    saveSettings(base());
    aiCheck.mockResolvedValue({
      ok: true,
      models: ["qwen3.6-27b"],
      model: "qwen3.6-27b",
      changed: true,
      latency_ms: 40,
    });
    const seen = vi.fn();
    window.addEventListener(AI_MODEL_EVENT, (e) => seen((e as CustomEvent).detail));
    await syncServerModel();
    expect(getSettings().ai.model).toBe("qwen3.6-27b");
    expect(seen).toHaveBeenCalledWith({ from: "qwen3.5-27b", to: "qwen3.6-27b" });
  });

  it("keeps the model when following is off or the server is down", async () => {
    saveSettings({ ...base(), aiAuto: { ...getSettings().aiAuto, followModel: false } });
    aiCheck.mockResolvedValue({ ok: true, models: ["x"], model: "x", changed: true, latency_ms: 1 });
    await syncServerModel();
    expect(getSettings().ai.model).toBe("qwen3.5-27b");

    saveSettings(base());
    aiCheck.mockResolvedValue({ ok: false, models: [], model: "", changed: false, latency_ms: 1, error: "down" });
    await syncServerModel();
    expect(getSettings().ai.model).toBe("qwen3.5-27b");
  });

  it("fills an empty model with the server's one", async () => {
    saveSettings({ ...base(), ai: { base_url: "u", api_key: "k", model: "" } });
    aiCheck.mockResolvedValue({ ok: true, models: ["m1"], model: "m1", changed: false, latency_ms: 1 });
    await syncServerModel();
    expect(getSettings().ai.model).toBe("m1");
  });

  it("does nothing when AI is not configured", async () => {
    expect(await syncServerModel()).toBeNull();
    expect(aiCheck).not.toHaveBeenCalled();
  });
});
