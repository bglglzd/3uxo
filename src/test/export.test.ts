import { describe, it, expect } from "vitest";
import { transcriptToTxt, transcriptToMd, exportFileName } from "../export";
import type { Meeting, Transcript } from "../types";

const meeting: Meeting = {
  id: "a",
  created_at: "2026-06-05T10:00:00Z",
  title: "Созвон с Иваном",
  participants: "Иван",
  topic: "Планы",
  duration_secs: 65,
  folder: "a",
  status: "transcribed",
};

const transcript: Transcript = {
  segments: [
    { speaker: "me", start_secs: 0, end_secs: 2, text: "Привет" },
    { speaker: "them", start_secs: 65, end_secs: 67, text: "Здравствуй" },
  ],
};

describe("export", () => {
  it("txt includes title, speakers and timestamps", () => {
    const txt = transcriptToTxt(meeting, transcript);
    expect(txt).toContain("Созвон с Иваном");
    expect(txt).toContain("[0:00] Я: Привет");
    expect(txt).toContain("[1:05] Собеседник: Здравствуй");
  });

  it("md has heading and bullet lines", () => {
    const md = transcriptToMd(meeting, transcript);
    expect(md).toContain("# Созвон с Иваном");
    expect(md).toContain("**Участники:** Иван");
    expect(md).toMatch(/- `0:00` \*\*Я:\*\* Привет/);
  });

  it("exportFileName sanitizes and adds extension", () => {
    expect(exportFileName(meeting, "md")).toBe("Созвон с Иваном.md");
    expect(
      exportFileName({ ...meeting, title: 'a/b:c*?' }, "txt"),
    ).toBe("a_b_c_.txt");
    expect(exportFileName({ ...meeting, title: "" }, "txt")).toBe("meeting.txt");
  });
});
