import { describe, it, expect, vi } from "vitest";

const { downloadAndInstall, relaunch } = vi.hoisted(() => ({
  relaunch: vi.fn(async () => {}),
  downloadAndInstall: vi.fn(async (cb: (e: unknown) => void) => {
  cb({ event: "Started", data: { contentLength: 200 } });
  cb({ event: "Progress", data: { chunkLength: 50 } });
  cb({ event: "Progress", data: { chunkLength: 150 } });
  cb({ event: "Finished" });
}),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(async () => ({
    version: "0.9.0",
    currentVersion: "0.8.0",
    body: "## Что нового",
    downloadAndInstall,
  })),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));

import { findUpdate, installUpdate } from "../updater";

describe("updater", () => {
  it("finds an update without installing it", async () => {
    const u = await findUpdate();
    expect(u?.version).toBe("0.9.0");
    expect(u?.notes).toBe("## Что нового");
    expect(downloadAndInstall).not.toHaveBeenCalled();
  });

  it("installs with progress and relaunches after consent", async () => {
    const u = (await findUpdate())!;
    const seen: number[] = [];
    await installUpdate(u, (p) => seen.push(p));
    expect(seen).toEqual([0, 25, 100, 100]);
    expect(relaunch).toHaveBeenCalled();
  });
});
