import { describe, it, expect, beforeEach } from "vitest";
import { logInfo, logError, getLogText, clearLog, setAppInfo } from "../log";

describe("log", () => {
  beforeEach(() => clearLog());

  it("records info and error entries with header", () => {
    setAppInfo("test-env");
    logInfo("hello");
    logError("ctx", new Error("boom"));
    const t = getLogText();
    expect(t).toContain("3uxo diagnostics");
    expect(t).toContain("test-env");
    expect(t).toContain("INFO hello");
    expect(t).toContain("ERROR ctx:");
    expect(t).toContain("boom");
  });

  it("clear empties the log", () => {
    logInfo("x");
    clearLog();
    expect(getLogText()).not.toContain("INFO x");
  });
});
