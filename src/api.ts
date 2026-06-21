import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type {
  Meeting,
  TrackFile,
  Transcript,
  AiConfig,
  MetadataSuggestion,
  WhisperConfig,
  RecState,
  ReportKind,
} from "./types";
import { logError, logInfo } from "./log";

/// invoke с логированием ошибок в диагностику.
async function inv<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    logError(`invoke ${cmd}`, e);
    throw e;
  }
}

/// Пустые строки → undefined, чтобы на стороне Rust получился None.
function whisperOptions(w: WhisperConfig) {
  return {
    whisperPath: w.whisperPath || undefined,
    model: w.model || undefined,
    language: w.language || undefined,
  };
}

export const api = {
  startRecording: (): Promise<string> => inv("start_recording"),
  stopRecording: (): Promise<Meeting> => inv("stop_recording"),
  pauseRecording: (): Promise<void> => inv("pause_recording"),
  resumeRecording: (): Promise<void> => inv("resume_recording"),
  importRecording: (path: string): Promise<Meeting> =>
    inv("import_recording", { path }),
  listMeetings: (): Promise<Meeting[]> => inv("list_meetings"),
  getMeeting: (id: string): Promise<Meeting> => inv("get_meeting", { id }),
  deleteMeeting: (id: string): Promise<void> => inv("delete_meeting", { id }),
  isRecording: (): Promise<boolean> => inv("is_recording"),
  recordingState: (): Promise<RecState> => inv("recording_state"),

  transcribe: (
    id: string,
    whisper: WhisperConfig,
    speakerCount?: number | null,
    solo?: boolean,
  ): Promise<Transcript> => {
    logInfo(
      `transcribe start id=${id} model=${whisper.model || "small"} speakers=${speakerCount ?? "auto"}${solo ? " solo" : ""}`,
    );
    return inv("transcribe", {
      id,
      options: whisperOptions(whisper),
      speakerCount: speakerCount ?? null,
      solo: solo ?? null,
    });
  },
  getTranscript: (id: string): Promise<Transcript | null> =>
    inv("get_transcript", { id }),
  /// Сохранить отредактированную расшифровку (правки whisper-ошибок/спикеров).
  saveTranscript: (id: string, transcript: Transcript): Promise<void> =>
    inv("save_transcript", { id, transcript }),
  /// Сохранить отредактированный ИИ-отчёт (brief|summary|analysis|literary).
  saveReport: (id: string, kind: ReportKind, content: string): Promise<void> =>
    inv("save_report", { id, kind, content }),

  suggestMetadata: (id: string, config: AiConfig): Promise<MetadataSuggestion> =>
    inv("suggest_metadata", { id, config }),
  summarize: (id: string, config: AiConfig): Promise<string> =>
    inv("summarize", { id, config }),
  getSummary: (id: string): Promise<string | null> => inv("get_summary", { id }),
  literaryText: (id: string, config: AiConfig): Promise<string> =>
    inv("literary_text", { id, config }),
  getLiterary: (id: string): Promise<string | null> =>
    inv("get_literary", { id }),
  briefSummary: (id: string, config: AiConfig): Promise<string> =>
    inv("brief_summary", { id, config }),
  getBrief: (id: string): Promise<string | null> => inv("get_brief", { id }),
  analyze: (id: string, config: AiConfig): Promise<string> =>
    inv("analyze", { id, config }),
  getAnalysis: (id: string): Promise<string | null> =>
    inv("get_analysis", { id }),
  ask: (id: string, config: AiConfig, question: string): Promise<string> =>
    inv("ask", { id, config, question }),
  updateMeetingMeta: (
    id: string,
    title: string,
    participants: string,
    topic: string,
  ): Promise<void> =>
    inv("update_meeting_meta", { id, title, participants, topic }),

  saveTextFile: (path: string, content: string): Promise<void> =>
    inv("save_text_file", { path, content }),

  exportAudio: (id: string, trackFile: TrackFile, dest: string): Promise<void> =>
    inv("export_audio", { id, trackFile, dest }),

  getBackendLog: (): Promise<string> => inv("get_backend_log"),

  /// Зарегистрировать глобальную горячую клавишу старт/стоп записи.
  /// Пустая строка/null — выключить хоткей.
  updateHotkey: (accelerator: string | null): Promise<void> =>
    inv("update_hotkey", { accelerator: accelerator || null }),

  /// Обновить конфиг авто-записи звонков (фоновый монитор аудио-сессий).
  setAutorecord: (
    enabled: boolean,
    processes: string[],
    autoStop: boolean,
    startDelaySecs: number,
    minKeepSecs: number,
  ): Promise<void> =>
    inv("set_autorecord", {
      enabled,
      processes,
      autoStop,
      startDelaySecs,
      minKeepSecs,
    }),

  async trackUrl(id: string, trackFile: TrackFile): Promise<string> {
    const path: string = await inv("track_path", { id, trackFile });
    return convertFileSrc(path);
  },
};
