export type Theme = "dark" | "light";

const KEY = "3uxo.theme";

/// Текущая тема: сохранённая пользователем или системная по умолчанию.
export function getTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return "dark";
}

/// Применяет тему к документу (через data-theme на <html>).
export function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
}

/// Сохраняет выбор и применяет его.
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
  applyTheme(theme);
}

/// Инициализация при старте (до рендера, чтобы не было вспышки).
export function initTheme(): Theme {
  const t = getTheme();
  applyTheme(t);
  return t;
}
