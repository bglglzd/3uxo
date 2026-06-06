type Level = "info" | "error";

interface Entry {
  t: string;
  level: Level;
  msg: string;
}

const MAX = 500;
const entries: Entry[] = [];
let appInfo = "";

function stamp(): string {
  return new Date().toISOString();
}

export function setAppInfo(info: string): void {
  appInfo = info;
}

function stringifyErr(e: unknown): string {
  if (e instanceof Error) return e.stack || `${e.name}: ${e.message}`;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function log(level: Level, msg: string): void {
  entries.push({ t: stamp(), level, msg });
  if (entries.length > MAX) entries.shift();
}

export function logInfo(msg: string): void {
  log("info", msg);
}

export function logError(context: string, e: unknown): void {
  log("error", `${context}: ${stringifyErr(e)}`);
}

/// Полный текст лога с шапкой (версия, окружение) — для отправки в баг-репорт.
export function getLogText(): string {
  const header = [
    "=== 3uxo diagnostics ===",
    `time: ${stamp()}`,
    `env: ${appInfo || (typeof navigator !== "undefined" ? navigator.userAgent : "")}`,
    `entries: ${entries.length}`,
  ].join("\n");
  const body = entries
    .map((e) => `[${e.t}] ${e.level.toUpperCase()} ${e.msg}`)
    .join("\n");
  return `${header}\n\n${body}\n`;
}

export function clearLog(): void {
  entries.length = 0;
}
