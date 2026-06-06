import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import type { Meeting, Transcript } from "../types";
import { api } from "../api";
import { getSettings } from "../settings";
import { activeSegmentIndex } from "../playback";
import { clock, transcriptToTxt, transcriptToMd, exportFileName } from "../export";
import { TranscriptView } from "./TranscriptView";
import { AiPanel } from "./AiPanel";

interface Props {
  meeting: Meeting;
  onMetaSaved: () => void;
}

export function MeetingView({ meeting, onMetaSaved }: Props) {
  const micRef = useRef<HTMLAudioElement>(null);
  const sysRef = useRef<HTMLAudioElement>(null);

  const [micUrl, setMicUrl] = useState("");
  const [sysUrl, setSysUrl] = useState("");
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState("");

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [title, setTitle] = useState(meeting.title);
  const [participants, setParticipants] = useState(meeting.participants);
  const [topic, setTopic] = useState(meeting.topic);

  useEffect(() => {
    setTitle(meeting.title);
    setParticipants(meeting.participants);
    setTopic(meeting.topic);
    setTime(0);
    setPlaying(false);
    setError("");
    api.trackUrl(meeting.id, "mic.wav").then(setMicUrl).catch(() => {});
    api.trackUrl(meeting.id, "system.wav").then(setSysUrl).catch(() => {});
    api.getTranscript(meeting.id).then(setTranscript).catch(() => {});
  }, [meeting.id]);

  const activeIndex = useMemo(
    () => (transcript ? activeSegmentIndex(transcript.segments, time) : -1),
    [transcript, time],
  );

  const togglePlay = () => {
    const mic = micRef.current;
    if (!mic) return;
    if (playing) {
      mic.pause();
      sysRef.current?.pause();
      setPlaying(false);
    } else {
      void mic.play();
      void sysRef.current?.play().catch(() => {});
      setPlaying(true);
    }
  };

  const seek = (t: number) => {
    if (micRef.current) micRef.current.currentTime = t;
    if (sysRef.current) sysRef.current.currentTime = t;
    setTime(t);
  };

  const transcribe = async () => {
    setError("");
    setTranscribing(true);
    try {
      setTranscript(await api.transcribe(meeting.id, getSettings().whisper));
      onMetaSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setTranscribing(false);
    }
  };

  const saveMeta = async () => {
    try {
      await api.updateMeetingMeta(meeting.id, title, participants, topic);
      onMetaSaved();
    } catch (e) {
      setError(String(e));
    }
  };

  const exportAs = async (fmt: "txt" | "md") => {
    if (!transcript) return;
    const content =
      fmt === "txt"
        ? transcriptToTxt(meeting, transcript)
        : transcriptToMd(meeting, transcript);
    try {
      const path = await save({
        defaultPath: exportFileName(meeting, fmt),
        filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }],
      });
      if (path) await api.saveTextFile(path, content);
    } catch (e) {
      setError(String(e));
    }
  };

  const pct = duration > 0 ? (time / duration) * 100 : 0;
  const hasTranscript = !!transcript && transcript.segments.length > 0;

  return (
    <div className="mv">
      <div className="mv-head">
        <div className="eyebrow">
          {new Date(meeting.created_at).toLocaleString()}{" "}
          <span className="status-tag">{meeting.status}</span>
        </div>
        <input
          className="mv-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveMeta}
          placeholder="Без названия"
        />
        <div className="mv-meta-row">
          <input
            className="chip-input"
            value={participants}
            onChange={(e) => setParticipants(e.target.value)}
            onBlur={saveMeta}
            placeholder="участники"
          />
          <input
            className="chip-input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onBlur={saveMeta}
            placeholder="тема"
          />
        </div>
      </div>

      {error && <div className="ai-error">{error}</div>}

      <div className="card">
        <div className="player">
          <button
            className="play-btn"
            onClick={togglePlay}
            aria-label={playing ? "Пауза" : "Играть"}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <div className="scrub">
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={time}
              onChange={(e) => seek(parseFloat(e.target.value))}
              style={{ ["--p" as string]: `${pct}%` } as CSSProperties}
            />
            <div className="times">
              <span>{clock(time)}</span>
              <span>{clock(duration)}</span>
            </div>
          </div>
        </div>
        <audio
          ref={micRef}
          src={micUrl || undefined}
          onTimeUpdate={() => micRef.current && setTime(micRef.current.currentTime)}
          onLoadedMetadata={() => {
            const d = micRef.current?.duration;
            if (d && Number.isFinite(d)) setDuration(d);
          }}
          onEnded={() => setPlaying(false)}
          preload="metadata"
        />
        <audio ref={sysRef} src={sysUrl || undefined} preload="metadata" />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Расшифровка</h3>
          <div className="spacer" />
          {hasTranscript ? (
            <div className="btn-row">
              <button className="btn ghost" onClick={() => exportAs("txt")}>
                ⬇ TXT
              </button>
              <button className="btn ghost" onClick={() => exportAs("md")}>
                ⬇ MD
              </button>
            </div>
          ) : (
            <button
              className="btn primary"
              onClick={transcribe}
              disabled={transcribing}
            >
              {transcribing ? "Расшифровываю…" : "Расшифровать"}
            </button>
          )}
        </div>
        <TranscriptView
          transcript={transcript}
          activeIndex={activeIndex}
          onSeek={seek}
        />
      </div>

      <AiPanel meeting={meeting} onMetaSaved={onMetaSaved} />
    </div>
  );
}
