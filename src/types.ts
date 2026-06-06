export interface Meeting {
  id: string;
  created_at: string;
  title: string;
  participants: string;
  topic: string;
  duration_secs: number;
  folder: string;
  status: string;
}

export type TrackFile = "mic.wav" | "system.wav";

export type Speaker = "me" | "them";

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

export interface AppSettings {
  ai: AiConfig;
  whisper: WhisperConfig;
}
