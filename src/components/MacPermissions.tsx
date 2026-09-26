import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

/// macOS: доступы, без которых запись неполная. Микрофон система спрашивает
/// сама при первой записи; системный звук (голоса собеседников) требует
/// разрешения «Запись экрана и системного звука».
export function MacPermissions() {
  const [system, setSystem] = useState<boolean | null>(null);

  const check = useCallback(async (request = false) => {
    try {
      setSystem(await api.systemAudioAccess(request));
    } catch {
      setSystem(null);
    }
  }, []);

  useEffect(() => {
    void check();
    // Вернулись из Системных настроек — перепроверяем.
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [check]);

  return (
    <div className="field mac-perms">
      <label>Доступы macOS</label>
      <div className="perm-row">
        <span className={system ? "perm-dot ok" : "perm-dot"} aria-hidden="true" />
        <div className="perm-text">
          <div className="perm-title">Системный звук — голоса собеседников</div>
          <div className="hint">
            {system
              ? "Разрешено. Звук самого Memiro в запись не попадает."
              : "Нужно разрешение «Запись экрана и системного звука». Без него пишется только микрофон. После включения перезапустите Memiro."}
          </div>
        </div>
        {!system && (
          <button
            className="btn btn-sm"
            onClick={async () => {
              await check(true);
              await api.openPrivacySettings("screen").catch(() => {});
            }}
          >
            Разрешить…
          </button>
        )}
      </div>
      <div className="perm-row">
        <span className="perm-dot neutral" aria-hidden="true" />
        <div className="perm-text">
          <div className="perm-title">Микрофон — ваш голос</div>
          <div className="hint">macOS спросит при первой записи. Изменить можно в Системных настройках.</div>
        </div>
        <button className="btn btn-sm ghost" onClick={() => void api.openPrivacySettings("mic").catch(() => {})}>
          Настройки…
        </button>
      </div>
    </div>
  );
}
