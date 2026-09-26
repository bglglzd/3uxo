import type { AiCheck } from "./types";
import { api } from "./api";
import { getSettings, saveSettings } from "./settings";
import { logError, logInfo } from "./log";

/// Событие «модель ИИ на сервере сменилась» — detail: { from, to }.
export const AI_MODEL_EVENT = "memiro-ai-model";

export interface AiModelChange {
  from: string;
  to: string;
}

/// Сверяет настройки с ИИ-сервером: какие модели он сейчас отдаёт. Если
/// включено «следить за моделью» и настроенной модели больше нет (на сервере
/// выкатили новую) — переключается на актуальную, сохраняет настройки и шлёт
/// событие для уведомления. Возвращает результат проверки (или null, если ИИ
/// не настроен).
export async function syncServerModel(): Promise<AiCheck | null> {
  const s = getSettings();
  if (!s.ai.base_url || !s.ai.api_key) return null;
  let r: AiCheck;
  try {
    r = await api.aiCheck(s.ai);
  } catch (e) {
    logError("ai check", e);
    return null;
  }
  if (!r.ok) {
    logInfo(`ai check failed: ${r.error ?? "?"}`);
    return r;
  }
  const current = s.ai.model.trim();
  // Пустая модель = «что отдаёт сервер» — сохраняем явно, чтобы было видно.
  const shouldSwitch =
    s.aiAuto.followModel && !!r.model && r.model !== current && (r.changed || !current);
  if (shouldSwitch) {
    // Перечитываем настройки прямо перед записью — их могли поменять.
    const fresh = getSettings();
    saveSettings({ ...fresh, ai: { ...fresh.ai, model: r.model } });
    logInfo(`ai model: ${current || "auto"} → ${r.model}`);
    if (current) {
      window.dispatchEvent(
        new CustomEvent<AiModelChange>(AI_MODEL_EVENT, { detail: { from: current, to: r.model } }),
      );
    }
  }
  return r;
}
