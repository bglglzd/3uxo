export interface Meeting {
  id: string;
  created_at: string;
  title: string;
  participants: string;
  topic: string;
  duration_secs: number;
  folder: string;
  status: string;
  /// "recorded" (записана приложением, 2 дорожки) | "imported" (один файл).
  /// Необязательно: бэкенд всегда присылает, но старые объекты могут не иметь.
  source?: string;
}

export type TrackFile = "mic.wav" | "system.wav" | "audio.wav";

/// Идентификатор говорящего: "me"/"them" для записей, "spk0"/"spk1"/… для
/// импортированных (после диаризации).
export type Speaker = string;

export interface TranscriptSegment {
  speaker: Speaker;
  start_secs: number;
  end_secs: number;
  text: string;
}

export interface Transcript {
  segments: TranscriptSegment[];
}

export interface AiConfig {
  base_url: string;
  api_key: string;
  model: string;
}

export interface MetadataSuggestion {
  title: string;
  participants: string;
  topic: string;
}

/// Настройки локального Whisper. Пустые поля означают «найди сам».
export interface WhisperConfig {
  whisperPath: string;
  model: string;
  language: string;
}

/// Авто-запись звонков: следим за аудио-сессиями выбранных приложений и
/// автоматически стартуем запись при звонке.
export interface AutoRecordConfig {
  enabled: boolean;
  /// Ключи приложений для слежения (см. AUTO_RECORD_APPS в labels/настройках).
  apps: string[];
  /// Останавливать запись по завершении звонка.
  autoStop: boolean;
  /// Сколько секунд звонок должен держаться до старта записи — отсекает
  /// короткие звуки уведомлений (Telegram «дзынь»). 0 — старт сразу.
  startDelaySecs: number;
  /// Авто-удалять авто-записи короче этого порога (сек) как мусорные огрызки
  /// уведомлений. 0 — не удалять.
  minKeepSecs: number;
}

/// Состояние записи: идёт ли запись и стоит ли она на паузе.
export interface RecState {
  recording: boolean;
  paused: boolean;
}

export interface AppSettings {
  ai: AiConfig;
  whisper: WhisperConfig;
  /// Глобальная горячая клавиша старт/стоп записи (акселератор Tauri,
  /// напр. "Ctrl+Shift+R"). Пусто — хоткей выключен.
  hotkey: string;
  autoRecord: AutoRecordConfig;
}

/// Состояние расшифровки одной встречи (живёт на уровне приложения, чтобы
/// переживать переход между встречами).
export interface TranscribeState {
  running: boolean;
  percent: number;
  stage?: string;
  /// Сколько фрагментов готово / всего (для счётчика прогресса).
  done?: number;
  total?: number;
  error?: string;
  /// Меняется при завершении — сигнал перезагрузить расшифровку.
  doneToken?: number;
}
