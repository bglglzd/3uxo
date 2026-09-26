/// Платформа, на которой запущено приложение. На macOS интерфейс следует
/// Apple HIG (системный шрифт, полупрозрачный сайдбар, ⌘ в подписях), на
/// Windows — прежний вид Auris.
export type Platform = "macos" | "windows" | "linux";

export function detectPlatform(ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): Platform {
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  if (/Windows/i.test(ua)) return "windows";
  return "linux";
}

export const platform: Platform = detectPlatform();
export const isMac = platform === "macos";

/// Ставит `data-platform` на <html> до рендера — CSS подстраивает вид.
export function initPlatform(p: Platform = platform): void {
  if (typeof document !== "undefined") document.documentElement.dataset.platform = p;
}

/// Глобальный хоткей по умолчанию: ⌘⇧R на Mac, Ctrl+Shift+R на Windows.
export function defaultHotkey(p: Platform = platform): string {
  return p === "macos" ? "Super+Shift+R" : "Ctrl+Shift+R";
}

const MAC_SYMBOLS: Record<string, string> = {
  Super: "⌘",
  Cmd: "⌘",
  Command: "⌘",
  CmdOrCtrl: "⌘",
  CommandOrControl: "⌘",
  Ctrl: "⌃",
  Control: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
  Enter: "↩",
  Space: "Space",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  Delete: "⌦",
  Tab: "⇥",
};

/// Клавиши акселератора для показа: на Mac — символы (⌘ ⇧ R), иначе как есть
/// (Super → Win).
export function accelKeys(accelerator: string, p: Platform = platform): string[] {
  const parts = accelerator ? accelerator.split("+").filter(Boolean) : [];
  if (p === "macos") return parts.map((k) => MAC_SYMBOLS[k] ?? k);
  return parts.map((k) => (k === "Super" ? "Win" : k));
}

/// Подпись сочетания одной строкой: «⌘⇧R» на Mac, «Ctrl+Shift+R» иначе.
export function formatAccel(accelerator: string, p: Platform = platform): string {
  return accelKeys(accelerator, p).join(p === "macos" ? "" : "+");
}

/// Название основного модификатора для подсказок («Ctrl+Enter» / «⌘↩»).
export function modEnter(p: Platform = platform): string {
  return p === "macos" ? "⌘↩" : "Ctrl+Enter";
}
