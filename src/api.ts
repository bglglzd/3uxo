import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type {
  Meeting,
  TrackFile,
  Transcript,
  AiConfig,
  MetadataSuggestion,
  WhisperConfig,
} from "./types";

/// Пустые строки → undefined, чтобы на стороне Rust получился None.
function whisperOptions(w: WhisperConfig) {
  return {
    whisperPath: w.whisperPath || undefined,
    model: w.model || undefined,
    language: w.language || undefined,
  };
}

export const api = {
  startRecording: (): Promise<string> => invoke("start_recording"),
  stopRecording: (): Promise<Meeting> => invoke("stop_recording"),
  listMeetings: (): Promise<Meeting[]> => invoke("list_meetings"),
  getMeeting: (id: string): Promise<Meeting> => invoke("get_meeting", { id }),
  deleteMeeting: (id: string): Promise<void> => invoke("delete_meeting", { id }),
  isRecording: (): Promise<boolean> => invoke("is_recording"),

  transcribe: (id: string, whisper: WhisperConfig): Promise<Transcript> =>
    invoke("transcribe", { id, options: whisperOptions(whisper) }),
  getTranscript: (id: string): Promise<Transcript | null> =>
    invoke("get_transcript", { id }),

  suggestMetadata: (id: string, config: AiConfig): Promise<MetadataSuggestion> =>
    invoke("suggest_metadata", { id, config }),
  summarize: (id: string, config: AiConfig): Promise<string> =>
    invoke("summarize", { id, config }),
  getSummary: (id: string): Promise<string | null> => invoke("get_summary", { id }),
  ask: (id: string, config: AiConfig, question: string): Promise<string> =>
    invoke("ask", { id, config, question }),
  updateMeetingMeta: (
    id: string,
    title: string,
    participants: string,
    topic: string,
  ): Promise<void> =>
    invoke("update_meeting_meta", { id, title, participants, topic }),

  saveTextFile: (path: string, content: string): Promise<void> =>
    invoke("save_text_file", { path, content }),

  async trackUrl(id: string, trackFile: TrackFile): Promise<string> {
    const path: string = await invoke("track_path", { id, trackFile });
    return convertFileSrc(path);
  },
};
