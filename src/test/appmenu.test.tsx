import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { emitAppMenu, useAppMenu } from "../appmenu";

function Probe({ onSettings, onFind }: { onSettings: () => void; onFind: () => void }) {
  useAppMenu("settings", onSettings);
  useAppMenu("find", onFind);
  return null;
}

describe("app menu", () => {
  it("routes menu items to their handlers only", () => {
    const onSettings = vi.fn();
    const onFind = vi.fn();
    const { unmount } = render(<Probe onSettings={onSettings} onFind={onFind} />);
    emitAppMenu("settings");
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(onFind).not.toHaveBeenCalled();
    emitAppMenu("find");
    expect(onFind).toHaveBeenCalledTimes(1);
    unmount();
    emitAppMenu("settings");
    expect(onSettings).toHaveBeenCalledTimes(1);
  });
});
