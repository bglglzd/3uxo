import { describe, it, expect } from "vitest";
import {
  transcriptToTxt,
  transcriptToMd,
  stenogramToTxt,
  stenogramToMd,
  exportFileName,
  mergeBySpeaker,
} from "../export";
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
  it("txt: one line per reply", () => {
    const txt = transcriptToTxt(meeting, transcript);
    expect(txt).toContain("Созвон с Иваном");
    expect(txt).toContain("[0:00] Я: Привет");
    expect(txt).toContain("[1:05] Собеседник: Здравствуй");
  });

  it("md: bullet line per reply", () => {
    const md = transcriptToMd(meeting, transcript);
    expect(md).toContain("# Созвон с Иваном");
    expect(md).toContain("**Участники:** Иван");
    expect(md).toContain("## Расшифровка");
    expect(md).toMatch(/- `0:00` \*\*Я:\*\* Привет/);
  });

  it("mergeBySpeaker groups consecutive same-speaker segments until interrupted", () => {
    const t: Transcript = {
      segments: [
        { speaker: "spk0", start_secs: 0, end_secs: 2, text: "Привет" },
        { speaker: "spk0", start_secs: 2, end_secs: 4, text: "как дела" },
        { speaker: "spk1", start_secs: 4, end_secs: 6, text: "Хорошо" },
        { speaker: "spk0", start_secs: 6, end_secs: 8, text: "Отлично" },
      ],
    };
    const blocks = mergeBySpeaker(t.segments);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ speaker: "spk0", start_secs: 0, end_secs: 4, text: "Привет как дела" });
    expect(blocks[1]).toMatchObject({ speaker: "spk1", text: "Хорошо" });
    expect(blocks[2]).toMatchObject({ speaker: "spk0", start_secs: 6, text: "Отлично" });
  });

  it("stenogram txt: grouped header + paragraph, first segment's timestamp", () => {
    const m2: Meeting = { ...meeting, title: "Звонок", participants: "", topic: "" };
    const t: Transcript = {
      segments: [
        { speaker: "me", start_secs: 0, end_secs: 2, text: "Раз" },
        { speaker: "me", start_secs: 3, end_secs: 5, text: "два" },
      ],
    };
    const txt = stenogramToTxt(m2, t);
    expect(txt).toContain("[0:00] Я\nРаз два");
    expect(txt).not.toContain("[0:03]");
  });

  it("stenogram md: bold header + paragraph", () => {
    const md = stenogramToMd(meeting, transcript);
    expect(md).toContain("## Стенограмма");
    expect(md).toContain("**[0:00] Я**");
    expect(md).toContain("Привет");
  });

  it("exportFileName sanitizes and adds extension", () => {
    expect(exportFileName(meeting, "md")).toBe("Созвон с Иваном.md");
    expect(
      exportFileName({ ...meeting, title: 'a/b:c*?' }, "txt"),
    ).toBe("a_b_c_.txt");
    expect(exportFileName({ ...meeting, title: "" }, "txt")).toBe("meeting.txt");
  });
});
