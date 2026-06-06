import { describe, it, expect } from "vitest";
import { activeSegmentIndex } from "../playback";
import type { TranscriptSegment } from "../types";

const segs: TranscriptSegment[] = [
  { speaker: "me", start_secs: 0, end_secs: 2, text: "a" },
  { speaker: "them", start_secs: 2, end_secs: 4, text: "b" },
  { speaker: "me", start_secs: 10, end_secs: 12, text: "c" },
];

describe("activeSegmentIndex", () => {
  it("returns -1 before the first segment", () => {
    expect(activeSegmentIndex(segs, -1)).toBe(-1);
  });
  it("finds the segment containing t", () => {
    expect(activeSegmentIndex(segs, 0)).toBe(0);
    expect(activeSegmentIndex(segs, 3)).toBe(1);
    expect(activeSegmentIndex(segs, 11)).toBe(2);
  });
  it("holds the last started segment during a gap", () => {
    expect(activeSegmentIndex(segs, 6)).toBe(1);
  });
  it("holds the last segment past the end", () => {
    expect(activeSegmentIndex(segs, 999)).toBe(2);
  });
});
