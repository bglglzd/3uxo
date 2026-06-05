import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/// Проверяет наличие обновления и, если оно есть, скачивает, устанавливает
/// и перезапускает приложение. Ошибки (нет сети / апдейтер не настроен)
/// проглатываются, чтобы не мешать запуску.
export async function checkForUpdates(): Promise<void> {
  try {
    const update = await check();
    if (update) {
      await update.downloadAndInstall();
      await relaunch();
    }
  } catch (e) {
    console.warn("update check failed", e);
  }
}
