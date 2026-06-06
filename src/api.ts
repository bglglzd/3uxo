import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type {
  Meeting,
  TrackFile,
  Transcript,
  AiConfig,
  MetadataSuggestion,
  WhisperConfig,
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
  listMeetings: (): Promise<Meeting[]> => inv("list_meetings"),
  getMeeting: (id: string): Promise<Meeting> => inv("get_meeting", { id }),
  deleteMeeting: (id: string): Promise<void> => inv("delete_meeting", { id }),
  isRecording: (): Promise<boolean> => inv("is_recording"),

  transcribe: (id: string, whisper: WhisperConfig): Promise<Transcript> => {
    logInfo(`transcribe start id=${id} model=${whisper.model || "small"}`);
    return inv("transcribe", { id, options: whisperOptions(whisper) });
  },
  getTranscript: (id: string): Promise<Transcript | null> =>
    inv("get_transcript", { id }),

  suggestMetadata: (id: string, config: AiConfig): Promise<MetadataSuggestion> =>
    inv("suggest_metadata", { id, config }),
  summarize: (id: string, config: AiConfig): Promise<string> =>
    inv("summarize", { id, config }),
  getSummary: (id: string): Promise<string | null> => inv("get_summary", { id }),
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

  async trackUrl(id: string, trackFile: TrackFile): Promise<string> {
    const path: string = await inv("track_path", { id, trackFile });
    return convertFileSrc(path);
  },
};
