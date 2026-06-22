import type { Transcript } from "./types";

/// Одно сквозное исправление: написание `from` → `to` (фамилия, компания,
/// термин). Применяется ко всем текстам встречи (расшифровка + ИИ-отчёты).
export interface Fix {
  from: string;
  to: string;
}

const keyFor = (meetingId: string) => `3uxo.fixes.${meetingId}`;

export function getFixes(meetingId: string): Fix[] {
  try {
    const raw = localStorage.getItem(keyFor(meetingId));
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr.filter(
          (f) => f && typeof f.from === "string" && typeof f.to === "string",
        );
      }
    }
  } catch {
    /* malformed — игнорируем */
  }
  return [];
}

export function setFixes(meetingId: string, fixes: Fix[]): void {
  localStorage.setItem(keyFor(meetingId), JSON.stringify(fixes));
}

/// Экранирование спецсимволов регэкспа в искомой строке.
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/// Применяет одно исправление к тексту: целое слово (границы — не буква/цифра),
/// регистронезависимо, Unicode. При отсутствии поддержки lookbehind/\p — простая
/// глобальная замена по подстроке.
function applyOne(text: string, from: string, to: string): string {
  const needle = from.trim();
  if (!needle) return text;
  try {
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRe(needle)}(?![\\p{L}\\p{N}])`,
      "giu",
    );
    return text.replace(re, to);
  } catch {
    return text.split(from).join(to);
  }
}

/// Применяет все исправления к тексту по порядку.
export function applyFixes(text: string, fixes: Fix[]): string {
  let out = text;
  for (const f of fixes) {
    if (f.from.trim()) out = applyOne(out, f.from, f.to);
  }
  return out;
}

/// Применяет исправления ко всем репликам расшифровки.
export function applyFixesToTranscript(t: Transcript, fixes: Fix[]): Transcript {
  return {
    segments: t.segments.map((s) => ({ ...s, text: applyFixes(s.text, fixes) })),
  };
}
