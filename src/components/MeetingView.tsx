import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import type { Meeting, Transcript, TranscribeState, TrackFile } from "../types";
import { api } from "../api";
import { getLabels, setLabels as saveLabels, nameForSpeaker, defaultName } from "../labels";
import type { SpeakerLabels } from "../labels";
import { activeSegmentIndex } from "../playback";
import {
  clock,
  transcriptToTxt,
  transcriptToMd,
  stenogramToTxt,
  stenogramToMd,
  exportFileName,
} from "../export";
import { TranscriptView } from "./TranscriptView";
import { AiPanel } from "./AiPanel";
import { CopyLogButton } from "./CopyLogButton";

interface Props {
  meeting: Meeting;
  transState?: TranscribeState;
  onTranscribe: (speakerCount: number | null) => void;
  onMetaSaved: () => void;
}

/// Русское склонение слова по числу: 1 голос, 2 голоса, 5 голосов.
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function MeetingView({ meeting, transState, onTranscribe, onMetaSaved }: Props) {
  // Импортированная запись — одна дорожка audio.wav (без разделения «Я/Собеседник»).
  const isImported = meeting.source === "imported";

  const micRef = useRef<HTMLAudioElement>(null);
  const sysRef = useRef<HTMLAudioElement>(null);

  const [micUrl, setMicUrl] = useState("");
  const [sysUrl, setSysUrl] = useState("");
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [error, setError] = useState("");

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [title, setTitle] = useState(meeting.title);
  const [participants, setParticipants] = useState(meeting.participants);
  const [topic, setTopic] = useState(meeting.topic);
  const [labels, setLbls] = useState<SpeakerLabels>(() => getLabels(meeting.id));

  // Сколько голосов в записи (для диаризации). Импорт: "auto"|2..8; запись: 1..8.
  const [speakerSel, setSpeakerSel] = useState<string>(
    () =>
      localStorage.getItem(`3uxo.speakers.${meeting.id}`) ??
      (isImported ? "auto" : "1"),
  );
  const updateSpeakerSel = (v: string) => {
    setSpeakerSel(v);
    localStorage.setItem(`3uxo.speakers.${meeting.id}`, v);
  };
  const speakerCountValue = (): number | null =>
    speakerSel === "auto" ? null : Number(speakerSel);

  const updateLabel = (key: string, value: string) => {
    const next = { ...labels, [key]: value };
    setLbls(next);
    saveLabels(meeting.id, next);
  };

  useEffect(() => {
    setTitle(meeting.title);
    setParticipants(meeting.participants);
    setTopic(meeting.topic);
    setTime(0);
    setPlaying(false);
    setError("");
    setLbls(getLabels(meeting.id));
    if (isImported) {
      api.trackUrl(meeting.id, "audio.wav").then(setMicUrl).catch(() => {});
      setSysUrl("");
    } else {
      api.trackUrl(meeting.id, "mic.wav").then(setMicUrl).catch(() => {});
      api.trackUrl(meeting.id, "system.wav").then(setSysUrl).catch(() => {});
    }
    api.getTranscript(meeting.id).then(setTranscript).catch(() => {});
  }, [meeting.id, isImported]);

  // Перезагрузка расшифровки, когда фоновая задача завершилась.
  useEffect(() => {
    if (transState?.doneToken) {
      api.getTranscript(meeting.id).then(setTranscript).catch(() => {});
    }
  }, [transState?.doneToken, meeting.id]);

  const transcribing = transState?.running ?? false;
  const percent = transState?.percent ?? 0;
  const stage = transState?.stage;
  const done = transState?.done ?? 0;
  const total = transState?.total ?? 0;
  const stageLabel =
    stage === "download"
      ? "Скачивание модели"
      : stage === "loading"
        ? "Загрузка модели в память"
        : stage === "diarize"
          ? "Разделение голосов"
          : stage === "system"
            ? "Дорожка собеседника"
            : isImported
              ? "Расшифровка"
              : "Дорожка «Я»";
  const shownError = error || transState?.error || "";

  const activeIndex = useMemo(
    () => (transcript ? activeSegmentIndex(transcript.segments, time) : -1),
    [transcript, time],
  );

  // Уникальные говорящие в расшифровке (для переименования импортированных).
  const speakers = useMemo(
    () =>
      transcript
        ? Array.from(new Set(transcript.segments.map((s) => s.speaker)))
        : [],
    [transcript],
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

  const saveMeta = async () => {
    try {
      await api.updateMeetingMeta(meeting.id, title, participants, topic);
      onMetaSaved();
    } catch (e) {
      setError(String(e));
    }
  };

  const downloadAudio = async (track: TrackFile, label: string) => {
    try {
      const path = await save({
        defaultPath: `${meeting.title || "meeting"} — ${label}.wav`,
        filters: [{ name: "WAV", extensions: ["wav"] }],
      });
      if (path) await api.exportAudio(meeting.id, track, path);
    } catch (e) {
      setError(String(e));
    }
  };

  const nameOf = (id: string) => nameForSpeaker(labels, id);

  // Обычный экспорт расшифровки (по реплике в строке) — TXT или MD.
  const exportAs = async (fmt: "txt" | "md") => {
    if (!transcript) return;
    const content =
      fmt === "txt"
        ? transcriptToTxt(meeting, transcript, nameOf)
        : transcriptToMd(meeting, transcript, nameOf);
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

  // Стенограмма (сгруппировано по говорящему, абзацы); формат — в диалоге.
  const exportStenogram = async () => {
    if (!transcript) return;
    try {
      const path = await save({
        defaultPath: exportFileName(meeting, "txt"),
        filters: [
          { name: "Текст", extensions: ["txt"] },
          { name: "Markdown", extensions: ["md"] },
        ],
      });
      if (!path) return;
      const content = path.toLowerCase().endsWith(".md")
        ? stenogramToMd(meeting, transcript, nameOf)
        : stenogramToTxt(meeting, transcript, nameOf);
      await api.saveTextFile(path, content);
    } catch (e) {
      setError(String(e));
    }
  };

  const pct = duration > 0 ? (time / duration) * 100 : 0;
  const hasTranscript = !!transcript && transcript.segments.length > 0;

  const speakerOptions = isImported ? [2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5, 6, 7, 8];
  const speakerSelect = (
    <select
      className="speaker-count"
      value={speakerSel}
      onChange={(e) => updateSpeakerSel(e.target.value)}
      title="Сколько голосов в записи — для разделения говорящих"
    >
      {isImported && <option value="auto">Голосов: авто</option>}
      {speakerOptions.map((n) => (
        <option key={n} value={String(n)}>
          {isImported
            ? `${n} ${plural(n, "голос", "голоса", "голосов")}`
            : `${n} ${plural(n, "собеседник", "собеседника", "собеседников")}`}
        </option>
      ))}
    </select>
  );

  return (
    <div className="mv">
      <div className="mv-head">
        <div className="eyebrow">
          {new Date(meeting.created_at).toLocaleString()}{" "}
          <span className="status-tag">{meeting.status}</span>
          <span className="local-badge" title="Расшифровка — локально на устройстве">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            Локально
          </span>
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
        {!isImported && (
          <div className="mv-meta-row speakers-row">
            <label className="speaker-edit">
              <span>Имя дорожки «Я»</span>
              <input
                className="chip-input"
                value={nameForSpeaker(labels, "me")}
                onChange={(e) => updateLabel("me", e.target.value)}
              />
            </label>
            <label className="speaker-edit">
              <span>Имя собеседника</span>
              <input
                className="chip-input"
                value={nameForSpeaker(labels, "them")}
                onChange={(e) => updateLabel("them", e.target.value)}
              />
            </label>
          </div>
        )}
        {isImported && speakers.length > 0 && (
          <div className="mv-meta-row speakers-row">
            {speakers.map((sp) => (
              <label className="speaker-edit" key={sp}>
                <span>{defaultName(sp)}</span>
                <input
                  className="chip-input"
                  value={nameForSpeaker(labels, sp)}
                  onChange={(e) => updateLabel(sp, e.target.value)}
                />
              </label>
            ))}
          </div>
        )}
      </div>

      {shownError && (
        <div className="ai-error error-banner">
          <span>{shownError}</span>
          <CopyLogButton className="btn ghost" />
        </div>
      )}

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
        <div className="track-downloads">
          {isImported ? (
            <button
              className="btn ghost"
              onClick={() => downloadAudio("audio.wav", "запись")}
            >
              ⬇ Скачать аудио
            </button>
          ) : (
            <>
              <button className="btn ghost" onClick={() => downloadAudio("mic.wav", "Я")}>
                ⬇ Аудио «Я»
              </button>
              <button
                className="btn ghost"
                onClick={() => downloadAudio("system.wav", "Собеседник")}
              >
                ⬇ Аудио собеседника
              </button>
            </>
          )}
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
          {transcribing ? (
            <span className="muted transcribing">
              <span className="spin">◜</span> {stageLabel}…
            </span>
          ) : hasTranscript ? (
            <div className="btn-row">
              <button className="btn ghost" onClick={() => exportAs("txt")}>
                ⬇ TXT
              </button>
              <button className="btn ghost" onClick={() => exportAs("md")}>
                ⬇ MD
              </button>
              <button
                className="btn ghost"
                onClick={exportStenogram}
                title="Сгруппированная стенограмма (.txt / .md)"
              >
                ⬇ Стенограмма
              </button>
              {speakerSelect}
              <button
                className="btn ghost"
                onClick={() => onTranscribe(speakerCountValue())}
                title="Перерасшифровать заново"
              >
                ↻ Заново
              </button>
            </div>
          ) : (
            <div className="btn-row">
              {speakerSelect}
              <button
                className="btn primary"
                onClick={() => onTranscribe(speakerCountValue())}
              >
                Расшифровать
              </button>
            </div>
          )}
        </div>
        {transcribing ? (
          <div className="card-body">
            <div className="progress">
              <div className="progress-bar" style={{ width: `${percent}%` }} />
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              {stageLabel}
              {total > 0 ? ` · фрагмент ${done}/${total}` : ""} ·{" "}
              {Math.round(percent)}%. Первый раз модель скачивается (выбранная в
              настройках) — это занимает несколько минут. Можно открыть другие
              встречи, расшифровка не прервётся.
            </p>
          </div>
        ) : (
          <TranscriptView
            transcript={transcript}
            activeIndex={activeIndex}
            labels={labels}
            onSeek={seek}
          />
        )}
      </div>

      <AiPanel meeting={meeting} onMetaSaved={onMetaSaved} />
    </div>
  );
}
