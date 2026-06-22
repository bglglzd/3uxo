import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getSettings, saveSettings } from "../settings";
import type { AppSettings } from "../types";
import { api } from "../api";
import { AUTO_RECORD_APPS, customProcs, resolveProcesses } from "../autorecord";
import { CopyLogButton } from "./CopyLogButton";
import { HotkeyCapture } from "./HotkeyCapture";

/// Переключатель-тумблер в стиле Auris.
function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={on ? "switch on" : "switch"}
      onClick={() => onChange(!on)}
    >
      <span className="switch-knob" />
    </button>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<AppSettings>(getSettings());
  const [proc, setProc] = useState("");
  const [version, setVersion] = useState("");

  // Версия приложения (из tauri.conf). В dev-превью без Tauri вернёт ошибку —
  // тогда просто не показываем номер.
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  const ai = (k: keyof AppSettings["ai"], v: string) =>
    setS({ ...s, ai: { ...s.ai, [k]: v } });
  const wh = (k: keyof AppSettings["whisper"], v: string) =>
    setS({ ...s, whisper: { ...s.whisper, [k]: v } });
  const ar = (patch: Partial<AppSettings["autoRecord"]>) =>
    setS({ ...s, autoRecord: { ...s.autoRecord, ...patch } });

  const toggleApp = (key: string) => {
    const has = s.autoRecord.apps.includes(key);
    ar({
      apps: has
        ? s.autoRecord.apps.filter((a) => a !== key)
        : [...s.autoRecord.apps, key],
    });
  };

  const addProc = () => {
    const p = proc.trim();
    if (!p || s.autoRecord.apps.includes(p)) {
      setProc("");
      return;
    }
    ar({ apps: [...s.autoRecord.apps, p] });
    setProc("");
  };

  const save = async () => {
    saveSettings(s);
    // Сразу применяем горячую клавишу (рантайм-регистрация).
    try {
      await api.updateHotkey(s.hotkey);
    } catch {
      // регистрация может не удаться (занято/неверно) — настройка всё равно
      // сохранена; пользователь увидит при следующем старте/проверит.
    }
    // Применяем конфиг авто-записи к фоновому монитору.
    try {
      await api.setAutorecord(
        s.autoRecord.enabled,
        resolveProcesses(s.autoRecord.apps),
        s.autoRecord.autoStop,
        s.autoRecord.startDelaySecs,
        s.autoRecord.minKeepSecs,
      );
    } catch {
      // не критично — применится при следующем запуске
    }
    onClose();
  };

  const custom = customProcs(s.autoRecord.apps);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Настройки</h2>
        <p className="lead">
          Запись и расшифровка работают локально. ИИ — опционально, через ваш
          ключ.
        </p>

        <div className="settings-privacy">
          <svg
            className="sp-shield"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 2l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <div className="sp-text">
            <div className="sp-title">
              Хранить всё локально <span className="sp-always">Всегда вкл</span>
            </div>
            <p>
              Записи, расшифровка и разделение голосов не покидают устройство.
              ИИ-функции — опционально, через ваш ключ ниже.
            </p>
          </div>
        </div>

        {/* ---------- Запись / горячая клавиша ---------- */}
        <details className="settings-section" open>
          <summary>
            <span className="sec-title">Запись</span>
            <span className="sec-sub">Горячая клавиша старт/стоп</span>
            <span className="sec-chev" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <div className="sec-body">
            <div className="field">
              <label>Глобальная горячая клавиша</label>
              <HotkeyCapture
                value={s.hotkey}
                onChange={(v) => setS({ ...s, hotkey: v })}
              />
              <span className="hint">
                Работает в любом приложении: нажми — начнётся запись, нажми ещё
                раз — остановится. Также доступно из значка в трее.
              </span>
            </div>
          </div>
        </details>

        {/* ---------- Авто-запись звонков ---------- */}
        <details className="settings-section" open>
          <summary>
            <span className="sec-title">Авто-запись звонков</span>
            <span className="sec-sub">Старт записи при звонке в мессенджерах</span>
            <span className="sec-chev" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <div className="sec-body">
            <div className="row-switch">
              <div>
                <div className="row-switch-title">
                  Автоматически записывать звонки
                </div>
                <div className="hint">
                  Auris следит за выбранными приложениями и сам начинает запись,
                  когда начинается звонок.
                </div>
              </div>
              <Switch
                on={s.autoRecord.enabled}
                onChange={(v) => ar({ enabled: v })}
                label="Автоматически записывать звонки"
              />
            </div>

            <div
              className={
                s.autoRecord.enabled ? "app-picker" : "app-picker disabled"
              }
            >
              <div className="app-grid">
                {AUTO_RECORD_APPS.map((app) => {
                  const checked = s.autoRecord.apps.includes(app.key);
                  return (
                    <label
                      key={app.key}
                      className={checked ? "app-item checked" : "app-item"}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!s.autoRecord.enabled}
                        onChange={() => toggleApp(app.key)}
                      />
                      <span className="app-check" aria-hidden="true" />
                      <span className="app-label">{app.label}</span>
                      {app.browser && <span className="app-tag">браузер</span>}
                    </label>
                  );
                })}
              </div>

              {custom.length > 0 && (
                <div className="custom-procs">
                  {custom.map((p) => (
                    <span className="proc-chip" key={p}>
                      {p}
                      <button
                        type="button"
                        onClick={() => toggleApp(p)}
                        aria-label={`Убрать ${p}`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="proc-add">
                <input
                  value={proc}
                  onChange={(e) => setProc(e.target.value)}
                  disabled={!s.autoRecord.enabled}
                  placeholder="Свой процесс, напр. Viber.exe"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addProc();
                  }}
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!s.autoRecord.enabled || !proc.trim()}
                  onClick={addProc}
                >
                  Добавить
                </button>
              </div>

              <div className="row-switch slim">
                <div className="row-switch-title">
                  Останавливать запись по завершении звонка
                </div>
                <Switch
                  on={s.autoRecord.autoStop}
                  onChange={(v) => ar({ autoStop: v })}
                  label="Останавливать запись по завершении звонка"
                />
              </div>

              <div className="field-row">
                <div className="field">
                  <label>Задержка перед стартом, сек</label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={s.autoRecord.startDelaySecs}
                    disabled={!s.autoRecord.enabled}
                    onChange={(e) =>
                      ar({ startDelaySecs: Math.max(0, Number(e.target.value) || 0) })
                    }
                  />
                  <span className="hint">
                    Звонок должен длиться столько секунд подряд, прежде чем
                    начнётся запись. Отсекает короткие звуки уведомлений
                    (Telegram «дзынь»). 0 — старт сразу.
                  </span>
                </div>
                <div className="field">
                  <label>Отбрасывать записи короче, сек</label>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={s.autoRecord.minKeepSecs}
                    disabled={!s.autoRecord.enabled}
                    onChange={(e) =>
                      ar({ minKeepSecs: Math.max(0, Number(e.target.value) || 0) })
                    }
                  />
                  <span className="hint">
                    Авто-записи короче порога удаляются как мусорные огрызки
                    уведомлений. 0 — не удалять.
                  </span>
                </div>
              </div>

              <div className="hint note">
                Детект звонка — по активной аудио-сессии приложения (Windows).
                Для звонков в браузере (Meet, Телемост) учитывается активный
                микрофон браузера.
              </div>
            </div>
          </div>
        </details>

        {/* ---------- Распознавание (Whisper) ---------- */}
        <details className="settings-section">
          <summary>
            <span className="sec-title">Распознавание</span>
            <span className="sec-sub">Whisper · локально, офлайн</span>
            <span className="sec-chev" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <div className="sec-body">
            <p className="hint">
              Расшифровка идёт локально, внутри приложения. Нужную модель Auris
              скачает сам один раз при первой расшифровке — ставить ничего не
              нужно.
            </p>
            <div className="field">
              <label>Модель</label>
              <select
                value={s.whisper.model || "medium"}
                onChange={(e) => wh("model", e.target.value)}
              >
                <option value="base">base — быстрее всего, ~142 МБ</option>
                <option value="small">small — быстрее, ~466 МБ</option>
                <option value="medium">
                  medium — точнее для русского, ~1.5 ГБ (рекомендуется)
                </option>
                <option value="large-v3">large-v3 — максимум качества, ~3 ГБ</option>
              </select>
              <span className="hint">
                Больше модель — точнее, но медленнее на CPU.
              </span>
            </div>
            <div className="field">
              <label>Язык</label>
              <input
                value={s.whisper.language}
                onChange={(e) => wh("language", e.target.value)}
                placeholder="ru"
              />
              <span className="hint">
                По умолчанию «ru». Впиши «auto» для автоопределения языка.
              </span>
            </div>
            <details className="adv">
              <summary>Использовать свой whisper (необязательно)</summary>
              <div className="field">
                <label>Путь к whisper-CLI</label>
                <input
                  value={s.whisper.whisperPath}
                  onChange={(e) => wh("whisperPath", e.target.value)}
                  placeholder="напр. C:\\tools\\whisper-cli.exe"
                />
                <span className="hint">
                  Если задано — используется он вместо встроенного движка.
                </span>
              </div>
            </details>
          </div>
        </details>

        {/* ---------- Искусственный интеллект ---------- */}
        <details className="settings-section">
          <summary>
            <span className="sec-title">Искусственный интеллект</span>
            <span className="sec-sub">Резюме и анализ · через ваш ключ</span>
            <span className="sec-chev" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <div className="sec-body">
            <div className="field">
              <label>Base URL</label>
              <input
                value={s.ai.base_url}
                onChange={(e) => ai("base_url", e.target.value)}
                placeholder="http://ai-pc.lan:18080/v1"
              />
            </div>
            <div className="field">
              <label>API-ключ</label>
              <input
                type="password"
                value={s.ai.api_key}
                onChange={(e) => ai("api_key", e.target.value)}
                placeholder="sk-no-key-required"
              />
              <span className="hint">
                Если ключ не нужен — впиши любой, напр. sk-no-key-required
              </span>
            </div>
            <div className="field">
              <label>Модель</label>
              <input
                value={s.ai.model}
                onChange={(e) => ai("model", e.target.value)}
                placeholder="qwen3.6-27b-q4"
              />
            </div>
          </div>
        </details>

        {/* ---------- Сквозные исправления ---------- */}
        <details className="settings-section">
          <summary>
            <span className="sec-title">Сквозные исправления</span>
            <span className="sec-sub">Единое написание имён и терминов</span>
            <span className="sec-chev" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <div className="sec-body">
            <div className="row-switch">
              <div>
                <div className="row-switch-title">
                  Исправлять слово сразу во всех текстах
                </div>
                <div className="hint">
                  Исправили фамилию, название компании или термин в одном месте —
                  Auris применит это написание ко всей расшифровке и всем
                  ИИ-отчётам (резюме, выжимка, анализ, литературный текст), а
                  также к новым отчётам. Блок «Сквозные исправления» появится в
                  карточке встречи.
                </div>
              </div>
              <Switch
                on={s.fixEverywhere}
                onChange={(v) => setS({ ...s, fixEverywhere: v })}
                label="Исправлять слово сразу во всех текстах"
              />
            </div>
          </div>
        </details>

        {/* ---------- Диагностика ---------- */}
        <details className="settings-section">
          <summary>
            <span className="sec-title">Диагностика</span>
            <span className="sec-sub">Лог для поддержки</span>
            <span className="sec-chev" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <div className="sec-body">
            <p className="hint">
              Если что-то идёт не так — скопируй лог и пришли его. В нём версия,
              окружение и последние ошибки (без твоих ключей и текста разговоров).
            </p>
            <div className="btn-row">
              <CopyLogButton className="btn" />
            </div>
          </div>
        </details>

        <div className="modal-actions">
          <span className="modal-version">
            {version ? `Auris v${version}` : "Auris"}
          </span>
          <div className="modal-actions-btns">
            <button className="btn ghost" onClick={onClose}>
              Отмена
            </button>
            <button className="btn primary" onClick={save}>
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
