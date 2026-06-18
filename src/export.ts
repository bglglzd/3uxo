import type { Meeting, Transcript } from "./types";
import { defaultName } from "./labels";

/// Преобразователь id говорящего в отображаемое имя.
export type NameOf = (speakerId: string) => string;

export function clock(secs: number): string {
  const safe = Math.max(0, Math.floor(secs));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/// Простой текст расшифровки.
export function transcriptToTxt(
  meeting: Meeting,
  transcript: Transcript,
  nameOf: NameOf = defaultName,
): string {
  const lines: string[] = [meeting.title || "Встреча"];
  if (meeting.participants) lines.push(`Участники: ${meeting.participants}`);
  if (meeting.topic) lines.push(`Тема: ${meeting.topic}`);
  lines.push("");
  for (const seg of transcript.segments) {
    lines.push(
      `[${clock(seg.start_secs)}] ${nameOf(seg.speaker)}: ${seg.text}`,
    );
  }
  return lines.join("\n") + "\n";
}

/// Markdown-версия расшифровки.
export function transcriptToMd(
  meeting: Meeting,
  transcript: Transcript,
  nameOf: NameOf = defaultName,
): string {
  const lines: string[] = [`# ${meeting.title || "Встреча"}`, ""];
  const meta: string[] = [];
  if (meeting.participants) meta.push(`**Участники:** ${meeting.participants}`);
  if (meeting.topic) meta.push(`**Тема:** ${meeting.topic}`);
  if (meeting.created_at) meta.push(`**Дата:** ${meeting.created_at}`);
  if (meta.length) {
    lines.push(meta.join("  \n"), "");
  }
  lines.push("## Расшифровка", "");
  for (const seg of transcript.segments) {
    lines.push(
      `- \`${clock(seg.start_secs)}\` **${nameOf(seg.speaker)}:** ${seg.text}`,
    );
  }
  return lines.join("\n") + "\n";
}

/// Безопасное имя файла из заголовка встречи.
export function exportFileName(meeting: Meeting, ext: "txt" | "md"): string {
  const base = (meeting.title || "meeting")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim()
    .slice(0, 80);
  return `${base || "meeting"}.${ext}`;
}
