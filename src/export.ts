import type { Meeting, Transcript, TranscriptSegment } from "./types";
import { defaultName } from "./labels";

/// Преобразователь id говорящего в отображаемое имя.
export type NameOf = (speakerId: string) => string;

export function clock(secs: number): string {
  const safe = Math.max(0, Math.floor(secs));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/// Блок стенограммы: подряд идущие реплики ОДНОГО говорящего склеены в один
/// блок (до момента, пока не вступит другой). Время — начало блока.
export interface SpeakerBlock {
  speaker: string;
  start_secs: number;
  end_secs: number;
  text: string;
}

/// Склеивает подряд идущие реплики одного говорящего в блоки.
export function mergeBySpeaker(segments: TranscriptSegment[]): SpeakerBlock[] {
  const blocks: SpeakerBlock[] = [];
  for (const s of segments) {
    const text = s.text.trim();
    if (!text) continue;
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === s.speaker) {
      last.text = `${last.text} ${text}`;
      last.end_secs = s.end_secs;
    } else {
      blocks.push({
        speaker: s.speaker,
        start_secs: s.start_secs,
        end_secs: s.end_secs,
        text,
      });
    }
  }
  return blocks;
}

/// Простой текст расшифровки — по реплике в строке (как было исторически).
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
    lines.push(`[${clock(seg.start_secs)}] ${nameOf(seg.speaker)}: ${seg.text}`);
  }
  return lines.join("\n") + "\n";
}

/// Markdown-версия расшифровки — по реплике в строке.
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
    lines.push(`- \`${clock(seg.start_secs)}\` **${nameOf(seg.speaker)}:** ${seg.text}`);
  }
  return lines.join("\n") + "\n";
}

/// Стенограмма (текст): блок — заголовок «[время] Имя», затем абзац с
/// объединённой репликой; блоки разделены пустой строкой.
export function stenogramToTxt(
  meeting: Meeting,
  transcript: Transcript,
  nameOf: NameOf = defaultName,
): string {
  const lines: string[] = [meeting.title || "Встреча"];
  if (meeting.participants) lines.push(`Участники: ${meeting.participants}`);
  if (meeting.topic) lines.push(`Тема: ${meeting.topic}`);
  lines.push("");
  const blocks = mergeBySpeaker(transcript.segments);
  blocks.forEach((b, i) => {
    lines.push(`[${clock(b.start_secs)}] ${nameOf(b.speaker)}`);
    lines.push(b.text);
    if (i < blocks.length - 1) lines.push("");
  });
  return lines.join("\n") + "\n";
}

/// Стенограмма (Markdown): блок — жирный заголовок «[время] Имя» и абзац текста.
export function stenogramToMd(
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
  lines.push("## Стенограмма", "");
  for (const b of mergeBySpeaker(transcript.segments)) {
    lines.push(`**[${clock(b.start_secs)}] ${nameOf(b.speaker)}**`, "", b.text, "");
  }
  return lines.join("\n") + "\n";
}

/// Простой текст расшифровки для вставки в другое приложение: реплики
/// сгруппированы по говорящему, без таймкодов и Markdown. «Имя: текст», блоки
/// разделены пустой строкой.
export function transcriptToPlain(
  transcript: Transcript,
  nameOf: NameOf = defaultName,
): string {
  return (
    mergeBySpeaker(transcript.segments)
      .map((b) => `${nameOf(b.speaker)}: ${b.text}`)
      .join("\n\n") + "\n"
  );
}

/// Убирает Markdown-разметку, оставляя читабельный текст для вставки в другое
/// приложение (Word, заметки, мессенджер). Снимает заголовки, списки, выделение,
/// ссылки, код и цитаты, схлопывает лишние пустые строки.
export function stripMarkdown(md: string): string {
  let t = md;
  // Блоки кода ```...``` → содержимое без ограждения.
  t = t.replace(/```[^\n]*\n([\s\S]*?)```/g, "$1");
  // Картинки ![alt](url) → alt.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Ссылки [текст](url) → текст.
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Заголовки (#…) и цитаты (>) в начале строки.
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s{0,3}>\s?/gm, "");
  // Маркеры списков: «- », «* », «+ », «1. ».
  t = t.replace(/^\s*([-*+]|\d+\.)\s+/gm, "");
  // Горизонтальные линии.
  t = t.replace(/^\s*([-*_])\1{2,}\s*$/gm, "");
  // Жирный/курсив/зачёркивание: **…**, __…__, *…*, _…_, ~~…~~.
  t = t.replace(/(\*\*|__)(.*?)\1/g, "$2");
  t = t.replace(/(\*|_)(.*?)\1/g, "$2");
  t = t.replace(/~~(.*?)~~/g, "$1");
  // Инлайн-код `…`.
  t = t.replace(/`([^`]+)`/g, "$1");
  // Разделители таблиц | … | → пробелы (грубо, для читабельности).
  t = t.replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, "");
  t = t.replace(/[ \t]*\|[ \t]*/g, "  ");
  // Схлопываем 3+ переводов строки до двух.
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

/// Безопасное имя файла из заголовка встречи.
export function exportFileName(meeting: Meeting, ext: "txt" | "md"): string {
  const base = (meeting.title || "meeting")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim()
    .slice(0, 80);
  return `${base || "meeting"}.${ext}`;
}
