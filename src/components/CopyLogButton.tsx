import { useState } from "react";
import { getLogText } from "../log";
import { api } from "../api";

export function CopyLogButton({ className = "btn ghost" }: { className?: string }) {
  const [done, setDone] = useState(false);

  const copy = async () => {
    let backend = "";
    try {
      backend = await api.getBackendLog();
    } catch {
      /* бэкенд-лог недоступен */
    }
    const text =
      getLogText() +
      (backend ? `\n=== backend log (3uxo.log) ===\n${backend}\n` : "");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // запасной путь, если clipboard API недоступен
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };

  return (
    <button className={className} onClick={copy}>
      {done ? "Скопировано ✓" : "📋 Скопировать лог"}
    </button>
  );
}
