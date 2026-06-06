import { useState } from "react";
import { getLogText } from "../log";

export function CopyLogButton({ className = "btn ghost" }: { className?: string }) {
  const [done, setDone] = useState(false);

  const copy = async () => {
    const text = getLogText();
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
