import { describe, it, expect, beforeEach } from "vitest";
import {
  applyFixes,
  applyFixesToTranscript,
  getFixes,
  setFixes,
} from "../fixes";
import type { Transcript } from "../types";

describe("fixes", () => {
  beforeEach(() => localStorage.clear());

  it("replaces whole word, case-insensitively, with canonical form", () => {
    const out = applyFixes("Иваноф пришёл. иваноф ушёл.", [
      { from: "Иваноф", to: "Иванов" },
    ]);
    expect(out).toBe("Иванов пришёл. Иванов ушёл.");
  });

  it("does not touch substrings inside other words", () => {
    // «Ив» не должно заменить начало «Иванов».
    const out = applyFixes("Иванов и Ив", [{ from: "Ив", to: "ИВ" }]);
    expect(out).toBe("Иванов и ИВ");
  });

  it("applies multiple fixes in order", () => {
    const out = applyFixes("ООО Ромашка, директор Петроф", [
      { from: "Ромашка", to: "Ромашка-Плюс" },
      { from: "Петроф", to: "Петров" },
    ]);
    expect(out).toBe("ООО Ромашка-Плюс, директор Петров");
  });

  it("ignores empty 'from'", () => {
    const out = applyFixes("текст", [{ from: "   ", to: "X" }]);
    expect(out).toBe("текст");
  });

  it("applies across all transcript segments", () => {
    const t: Transcript = {
      segments: [
        { speaker: "me", start_secs: 0, end_secs: 1, text: "Звонил Петроф" },
        { speaker: "them", start_secs: 1, end_secs: 2, text: "да, Петроф" },
      ],
    };
    const fixed = applyFixesToTranscript(t, [{ from: "Петроф", to: "Петров" }]);
    expect(fixed.segments.map((s) => s.text)).toEqual([
      "Звонил Петров",
      "да, Петров",
    ]);
  });

  it("get/set round-trips per meeting and filters malformed", () => {
    expect(getFixes("m1")).toEqual([]);
    setFixes("m1", [{ from: "a", to: "b" }]);
    expect(getFixes("m1")).toEqual([{ from: "a", to: "b" }]);
    localStorage.setItem("3uxo.fixes.m2", '[{"from":"a"},{"bad":1},"x"]');
    expect(getFixes("m2")).toEqual([]);
  });
});
