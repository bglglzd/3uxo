import { useEffect, useState } from "react";
import { accelKeys, isMac } from "../platform";

interface Props {
  /// Текущий акселератор, напр. "Ctrl+Shift+R" (пусто — хоткей выключен).
  value: string;
  onChange: (accelerator: string) => void;
}

const MOD_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

/// Переводит event.code в токен акселератора Tauri (или null, если клавиша не
/// подходит для хоткея).
function codeToToken(code: string): string | null {
  const m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  const d = /^Digit([0-9])$/.exec(code);
  if (d) return d[1];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code; // F1..F24
  const map: Record<string, string> = {
    Space: "Space",
    Enter: "Enter",
    Tab: "Tab",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Insert: "Insert",
    Delete: "Delete",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
  };
  return map[code] ?? null;
}

export function HotkeyCapture({ value, onChange }: Props) {
  const [listening, setListening] = useState(false);
  const [hint, setHint] = useState("");

  useEffect(() => {
    if (!listening) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setListening(false);
        setHint("");
        return;
      }
      // Ждём не-модификатор: пока нажаты только модификаторы — подсказываем.
      if (MOD_CODES.has(e.code)) {
        setHint("…и обычную клавишу");
        return;
      }
      const key = codeToToken(e.code);
      if (!key) {
        setHint("Эта клавиша не подходит — попробуйте букву/цифру/F-клавишу");
        return;
      }
      const mods: string[] = [];
      // Порядок как в подписях системы: ⌃⌥⇧⌘ на Mac, Ctrl+Shift+Alt+Win иначе.
      if (isMac) {
        if (e.ctrlKey) mods.push("Ctrl");
        if (e.altKey) mods.push("Alt");
        if (e.shiftKey) mods.push("Shift");
        if (e.metaKey) mods.push("Super");
      } else {
        if (e.ctrlKey) mods.push("Ctrl");
        if (e.shiftKey) mods.push("Shift");
        if (e.altKey) mods.push("Alt");
        if (e.metaKey) mods.push("Super");
      }
      if (mods.length === 0) {
        setHint(isMac ? "Добавьте модификатор: ⌘ / ⌥ / ⇧ / ⌃" : "Добавьте модификатор: Ctrl / Alt / Shift / Win");
        return;
      }
      onChange([...mods, key].join("+"));
      setListening(false);
      setHint("");
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [listening, onChange]);

  const parts = accelKeys(value);

  return (
    <div className="hotkey">
      <div className={listening ? "hotkey-combo listening" : "hotkey-combo"}>
        {listening ? (
          <span className="hotkey-listening">Нажмите сочетание…</span>
        ) : parts.length ? (
          parts.map((p, i) => (
            <kbd key={i} className="hotkey-key">
              {p}
            </kbd>
          ))
        ) : (
          <span className="hotkey-none">Выключено</span>
        )}
      </div>
      <div className="hotkey-actions">
        {listening ? (
          <button
            className="btn ghost btn-sm"
            onClick={() => {
              setListening(false);
              setHint("");
            }}
          >
            Отмена
          </button>
        ) : (
          <>
            <button
              className="btn btn-sm"
              onClick={() => {
                setHint("");
                setListening(true);
              }}
            >
              Изменить
            </button>
            {value && (
              <button
                className="btn ghost btn-sm"
                onClick={() => onChange("")}
                title="Выключить горячую клавишу"
              >
                Выключить
              </button>
            )}
          </>
        )}
      </div>
      {(hint || listening) && (
        <div className="hotkey-hint">
          {hint || (isMac ? "Esc — отмена. Например: ⌘ ⇧ R" : "Esc — отмена. Например: Ctrl + Shift + R")}
        </div>
      )}
    </div>
  );
}
