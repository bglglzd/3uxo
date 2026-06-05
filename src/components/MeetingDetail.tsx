import { useEffect, useState } from "react";
import type { Meeting, Transcript } from "../types";
import { api } from "../api";
import { AiPanel } from "./AiPanel";

interface Props {
  meeting: Meeting;
  onBack: () => void;
  onMetaSaved: () => void;
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MeetingDetail({ meeting, onBack, onMetaSaved }: Props) {
  const [micUrl, setMicUrl] = useState<string>("");
  const [systemUrl, setSystemUrl] = useState<string>("");
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [transcribing, setTranscribing] = useState(false);

  useEffect(() => {
    api.trackUrl(meeting.id, "mic.wav").then(setMicUrl);
    api.trackUrl(meeting.id, "system.wav").then(setSystemUrl);
    api.getTranscript(meeting.id).then(setTranscript);
  }, [meeting.id]);

  const handleTranscribe = async () => {
    setTranscribing(true);
    try {
      setTranscript(await api.transcribe(meeting.id));
    } finally {
      setTranscribing(false);
    }
  };

  const hasTranscript = !!transcript && transcript.segments.length > 0;

  return (
    <div className="meeting-detail">
      <button className="back" onClick={onBack}>
        ← Назад
      </button>
      <h2>{meeting.title}</h2>
      <p className="detail-meta">
        {new Date(meeting.created_at).toLocaleString()}
        {meeting.participants && ` · ${meeting.participants}`}
        {meeting.topic && ` · ${meeting.topic}`}
      </p>

      <div className="track">
        <span className="track-label">Я (микрофон)</span>
        {micUrl && <audio controls src={micUrl} />}
      </div>
      <div className="track">
        <span className="track-label">Собеседник (системный звук)</span>
        {systemUrl && <audio controls src={systemUrl} />}
      </div>

      <section className="transcript">
        <h3>Расшифровка</h3>
        {hasTranscript ? (
          <ul className="transcript-list">
            {transcript!.segments.map((seg, i) => (
              <li key={i} className={`turn turn-${seg.speaker}`}>
                <span className="turn-speaker">
                  {seg.speaker === "me" ? "Я" : "Собеседник"}
                </span>
                <span className="turn-time">{formatTime(seg.start_secs)}</span>
                <span className="turn-text">{seg.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <button
            className="transcribe-btn"
            onClick={handleTranscribe}
            disabled={transcribing}
          >
            {transcribing ? "Расшифровка…" : "Расшифровать"}
          </button>
        )}
      </section>

      <AiPanel meeting={meeting} onMetaSaved={onMetaSaved} />
    </div>
  );
}
