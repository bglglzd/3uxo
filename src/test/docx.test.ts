import { describe, it, expect } from "vitest";
import { crc32, inlineRuns, markdownToBody, markdownToDocx, toBase64, zipStore } from "../docx";
import { buildDocumentMd, buildDocumentTxt, srtTime, transcriptToSrt } from "../export";
import type { Meeting, Transcript } from "../types";

const meeting: Meeting = {
  id: "a",
  created_at: "2026-06-04T10:00:00Z",
  title: "Бюджет",
  participants: "Иван",
  topic: "",
  duration_secs: 65,
  folder: "a",
  status: "transcribed",
};
const transcript: Transcript = {
  segments: [
    { speaker: "me", start_secs: 0, end_secs: 1.5, text: "Привет" },
    { speaker: "me", start_secs: 1.5, end_secs: 3, text: "как дела?" },
    { speaker: "spk0", start_secs: 61.25, end_secs: 62, text: "Норм" },
  ],
};

describe("docx", () => {
  it("crc32 matches the reference value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("zip has local headers and an end record", () => {
    const z = zipStore([{ name: "a.txt", data: new TextEncoder().encode("hi") }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
  });

  it("converts markdown blocks and inline marks", () => {
    const body = markdownToBody(
      "## Итоги\n\nТекст **важно** и *курсив*\n\n- [ ] задача\n- пункт\n\n| A | B |\n|---|---|\n| 1 | 2 |\n",
    );
    expect(body).toContain('w:val="Heading2"');
    expect(body).toContain("<w:b/>");
    expect(body).toContain("<w:i/>");
    expect(body).toContain("☐ задача");
    expect(body).toContain("• пункт");
    expect(body).toContain("<w:tbl>");
    expect(inlineRuns("a < b & c")).toContain("a &lt; b &amp; c");
  });

  it("builds a docx package and base64-encodes it", () => {
    const bytes = markdownToDocx("# Заголовок\n\nТекст", "Встреча");
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("word/document.xml");
    expect(text).toContain("[Content_Types].xml");
    expect(atob(toBase64(bytes)).length).toBe(bytes.length);
  });
});

describe("document export", () => {
  const nameOf = (id: string) => (id === "me" ? "Я" : "Олег");

  it("md: header, reports with demoted headings, grouped transcript", () => {
    const md = buildDocumentMd(
      meeting,
      {
        transcript,
        includeTranscript: true,
        timecodes: true,
        reports: [{ title: "Итоги встречи", markdown: "## Коротко\nвсё ок" }],
      },
      nameOf,
    );
    expect(md).toMatch(/^# Бюджет/);
    expect(md).toContain("**Участники:** Иван");
    expect(md).toContain("## Итоги встречи");
    expect(md).toContain("### Коротко");
    expect(md).toContain("**[0:00] Я**\n\nПривет как дела?");
    expect(md).toContain("**[1:01] Олег**");
  });

  it("txt has no markdown; timecodes are optional", () => {
    const txt = buildDocumentTxt(
      meeting,
      { transcript, includeTranscript: true, timecodes: false, reports: [] },
      nameOf,
    );
    expect(txt).not.toContain("**");
    expect(txt).toContain("Я\nПривет как дела?");
  });

  it("srt uses exact timings per replica", () => {
    expect(srtTime(3661.5)).toBe("01:01:01,500");
    const srt = transcriptToSrt(transcript, nameOf);
    expect(srt.startsWith("1\n00:00:00,000 --> 00:00:01,500\nЯ: Привет\n")).toBe(true);
    expect(srt).toContain("3\n00:01:01,250 --> 00:01:02,000\nОлег: Норм");
  });
});
