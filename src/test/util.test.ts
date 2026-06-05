import { describe, it, expect } from "vitest";
import { formatClock } from "../util";

describe("formatClock", () => {
  it('formats 0 as "0:00"', () => {
    expect(formatClock(0)).toBe("0:00");
  });

  it('formats 65 as "1:05"', () => {
    expect(formatClock(65)).toBe("1:05");
  });

  it('formats negative numbers as "0:00"', () => {
    expect(formatClock(-5)).toBe("0:00");
  });
});
