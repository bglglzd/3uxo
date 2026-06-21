/// Копирует текст в буфер обмена. Сначала через Clipboard API, при недоступности
/// — запасной путь через скрытый textarea + execCommand («copy»).
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Clipboard API недоступен (старый webview / нет фокуса) — запасной путь.
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    /* ignore */
  }
  document.body.removeChild(ta);
}
