/// Каталог приложений для авто-записи звонков. `processes` — имена процессов
/// Windows, по аудио-сессиям которых движок детекции (этап B) определяет звонок.
/// `browser: true` — звонок идёт внутри браузера (детект грубее: по активной
/// микрофонной сессии браузера).
export interface AutoRecordApp {
  key: string;
  label: string;
  processes: string[];
  browser?: boolean;
}

export const AUTO_RECORD_APPS: AutoRecordApp[] = [
  { key: "telegram", label: "Telegram", processes: ["Telegram.exe"] },
  { key: "discord", label: "Discord", processes: ["Discord.exe"] },
  { key: "whatsapp", label: "WhatsApp", processes: ["WhatsApp.exe"] },
  { key: "zoom", label: "Zoom", processes: ["Zoom.exe", "CptHost.exe"] },
  {
    key: "teams",
    label: "Microsoft Teams",
    processes: ["ms-teams.exe", "Teams.exe"],
  },
  { key: "skype", label: "Skype", processes: ["Skype.exe"] },
  { key: "slack", label: "Slack", processes: ["slack.exe"] },
  {
    key: "webex",
    label: "Cisco Webex",
    processes: ["webexmta.exe", "CiscoCollabHost.exe"],
  },
  {
    key: "meet",
    label: "Google Meet (браузер)",
    processes: ["chrome.exe", "msedge.exe", "firefox.exe"],
    browser: true,
  },
  {
    key: "telemost",
    label: "Яндекс Телемост (браузер)",
    processes: ["chrome.exe", "msedge.exe", "browser.exe"],
    browser: true,
  },
];

const KNOWN_KEYS = new Set(AUTO_RECORD_APPS.map((a) => a.key));
const BY_KEY = new Map(AUTO_RECORD_APPS.map((a) => [a.key, a]));

/// Записи из настроек, не входящие в каталог, — это добавленные пользователем
/// имена процессов (custom).
export function customProcs(apps: string[]): string[] {
  return apps.filter((a) => !KNOWN_KEYS.has(a));
}

/// Разворачивает выбранные ключи приложений + кастомные процессы в плоский
/// список имён процессов (.exe) для бэкенд-монитора. Без дублей.
export function resolveProcesses(apps: string[]): string[] {
  const out = new Set<string>();
  for (const a of apps) {
    const known = BY_KEY.get(a);
    if (known) known.processes.forEach((p) => out.add(p));
    else out.add(a);
  }
  return [...out];
}
