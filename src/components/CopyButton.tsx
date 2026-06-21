import { useState } from "react";
import { copyToClipboard } from "../clipboard";

/// Кнопка «скопировать в буфер» с галочкой-подтверждением. `text` — строка или
/// функция, дающая строку в момент клика (удобно для отложенной очистки Markdown).
export function CopyButton({
  text,
  className = "btn ghost",
  label = "📋 Копировать",
  doneLabel = "Скопировано ✓",
  title,
}: {
  text: string | (() => string);
  className?: string;
  label?: string;
  doneLabel?: string;
  title?: string;
}) {
  const [done, setDone] = useState(false);

  const copy = async () => {
    const value = typeof text === "function" ? text() : text;
    await copyToClipboard(value);
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };

  return (
    <button className={className} onClick={copy} title={title} type="button">
      {done ? doneLabel : label}
    </button>
  );
}
