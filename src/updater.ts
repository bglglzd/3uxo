import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { logError, logInfo } from "./log";

/// Как часто перепроверять обновления, пока приложение открыто.
export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/// Найденное обновление для интерфейса.
export interface UpdateInfo {
  version: string;
  currentVersion: string;
  /// Что нового (тело релиза), может быть пустым.
  notes: string;
  date?: string;
  /// Ссылка на объект апдейтера — для установки после согласия.
  handle: Update;
}

/// Проверяет, есть ли новая версия. Ничего не ставит — только сообщает.
/// Ошибки (нет сети, апдейтер недоступен в превью) → null.
export async function findUpdate(): Promise<UpdateInfo | null> {
  try {
    const u = await check();
    if (!u) return null;
    logInfo(`update available: ${u.currentVersion} → ${u.version}`);
    return {
      version: u.version,
      currentVersion: u.currentVersion,
      notes: u.body ?? "",
      date: u.date,
      handle: u,
    };
  } catch (e) {
    console.warn("update check failed", e);
    return null;
  }
}

/// Скачивает и ставит обновление (после согласия пользователя), сообщая
/// прогресс 0..100 (или -1, если размер неизвестен), затем перезапускает.
export async function installUpdate(
  info: UpdateInfo,
  onProgress: (percent: number) => void,
): Promise<void> {
  let total = 0;
  let got = 0;
  try {
    await info.handle.downloadAndInstall((ev) => {
      if (ev.event === "Started") {
        total = ev.data.contentLength ?? 0;
        onProgress(total ? 0 : -1);
      } else if (ev.event === "Progress") {
        got += ev.data.chunkLength;
        onProgress(total ? Math.min(100, (got / total) * 100) : -1);
      } else if (ev.event === "Finished") {
        onProgress(100);
      }
    });
  } catch (e) {
    logError("update install", e);
    throw e;
  }
  await relaunch();
}
