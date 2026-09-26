import { describe, expect, it } from "vitest";
import { accelKeys, defaultHotkey, detectPlatform, formatAccel, initPlatform, modEnter } from "../platform";

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120";

describe("platform", () => {
  it("detects macOS (Intel и Apple Silicon — один UA WebKit) and Windows", () => {
    expect(detectPlatform(MAC_UA)).toBe("macos");
    expect(detectPlatform(WIN_UA)).toBe("windows");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });

  it("uses ⌘⇧R on Mac and Ctrl+Shift+R elsewhere by default", () => {
    expect(defaultHotkey("macos")).toBe("Super+Shift+R");
    expect(defaultHotkey("windows")).toBe("Ctrl+Shift+R");
  });

  it("formats accelerators with Mac symbols", () => {
    expect(accelKeys("Super+Shift+R", "macos")).toEqual(["⌘", "⇧", "R"]);
    expect(formatAccel("Ctrl+Alt+Shift+Super+K", "macos")).toBe("⌃⌥⇧⌘K");
    expect(formatAccel("Ctrl+Shift+R", "windows")).toBe("Ctrl+Shift+R");
    expect(accelKeys("Super+R", "windows")).toEqual(["Win", "R"]);
    expect(accelKeys("", "macos")).toEqual([]);
    expect(modEnter("macos")).toBe("⌘↩");
    expect(modEnter("windows")).toBe("Ctrl+Enter");
  });

  it("marks the document with data-platform", () => {
    initPlatform("macos");
    expect(document.documentElement.dataset.platform).toBe("macos");
    initPlatform("windows");
    expect(document.documentElement.dataset.platform).toBe("windows");
  });
});
