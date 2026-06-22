import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import type {
  Meeting,
  Transcript,
  TranscribeState,
  TrackFile,
  ReportKind,
} from "../types";
import { api } from "../api";
import { getSettings } from "../settings";
import { getLabels, setLabels as saveLabels, nameForSpeaker, defaultName } from "../labels";
import type { SpeakerLabels } from "../labels";
import {
  getFixes,
  setFixes as persistFixes,
  applyFixes,
  applyFixesToTranscript,
} from "../fixes";
import type { Fix } from "../fixes";
import { activeSegmentIndex } from "../playback";
import {
  clock,
  transcriptToTxt,
  transcriptToMd,
  transcriptToPlain,
  stenogramToTxt,
  stenogramToMd,
  exportFileName,
} from "../export";
import { TranscriptView } from "./TranscriptView";
import { AiPanel } from "./AiPanel";
import { CopyLogButton } from "./CopyLogButton";
import { CopyButton } from "./CopyButton";

interface Props {
  meeting: Meeting;
  transState?: TranscribeState;
  onTranscribe: (speakerCount: number | null, solo: boolean) => void;
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
  // Соло-режим «я один»: помечается при старте записи (см. App.handleStart).
  // Расшифровываем только микрофон, один голос «Я», без диаризации.
  const isSolo =
    !isImported && localStorage.getItem(`3uxo.solo.${meeting.id}`) === "1";

  const micRef = useRef<HTMLAudioElement>(null);
  const sysRef = useRef<HTMLAudioElement>(null);

  const [micUrl, setMicUrl] = useState("");
  const [sysUrl, setSysUrl] = useState("");
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [error, setError] = useState("");
  // Правка расшифровки: черновик живёт отдельно, пишется в файл по «Сохранить».
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Transcript | null>(null);
  // Сквозные исправления: словарь замен встречи + ввод нового + busy + сигнал
  // перезагрузки ИИ-отчётов после применения.
  const [fixes, setFixesState] = useState<Fix[]>(() => getFixes(meeting.id));
  const [fixFrom, setFixFrom] = useState("");
  const [fixTo, setFixTo] = useState("");
  const [applyingFixes, setApplyingFixes] = useState(false);
  const [reportsToken, setReportsToken] = useState(0);
  const fixEnabled = getSettings().fixEverywhere;

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
    setEditing(false);
    setDraft(null);
    setFixesState(getFixes(meeting.id));
    setFixFrom("");
    setFixTo("");
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
      // Новая расшифровка перетирает черновик правок — выходим из режима правки.
      setEditing(false);
      setDraft(null);
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

  // ---- Правка расшифровки ----
  const startEdit = () => {
    if (!transcript) return;
    setDraft({ segments: transcript.segments.map((s) => ({ ...s })) });
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setDraft(null);
  };
  const editText = (i: number, text: string) =>
    setDraft((d) =>
      d
        ? { segments: d.segments.map((s, j) => (j === i ? { ...s, text } : s)) }
        : d,
    );
  const editSpeaker = (i: number, speaker: string) =>
    setDraft((d) =>
      d
        ? { segments: d.segments.map((s, j) => (j === i ? { ...s, speaker } : s)) }
        : d,
    );
  const deleteSegment = (i: number) =>
    setDraft((d) => (d ? { segments: d.segments.filter((_, j) => j !== i) } : d));
  const saveEdit = async () => {
    if (!draft) return;
    // Пустые после правки реплики убираем (очистка текста = удалить строку).
    const cleaned: Transcript = {
      segments: draft.segments.filter((s) => s.text.trim().length > 0),
    };
    try {
      await api.saveTranscript(meeting.id, cleaned);
      setTranscript(cleaned);
      setEditing(false);
      setDraft(null);
    } catch (e) {
      setError(String(e));
    }
  };

  // ---- Сквозные исправления ----
  const reportGetters: [ReportKind, (id: string) => Promise<string | null>][] = [
    ["brief", api.getBrief],
    ["summary", api.getSummary],
    ["analysis", api.getAnalysis],
    ["literary", api.getLiterary],
  ];
  // Применяет переданные замены к расшифровке и всем ИИ-отчётам встречи.
  const applyFixList = async (list: Fix[]) => {
    if (list.length === 0) return;
    setApplyingFixes(true);
    try {
      if (transcript) {
        const next = applyFixesToTranscript(transcript, list);
        setTranscript(next);
        await api.saveTranscript(meeting.id, next);
      }
      for (const [kind, get] of reportGetters) {
        const content = await get(meeting.id);
        if (!content) continue;
        const fixed = applyFixes(content, list);
        if (fixed !== content) await api.saveReport(meeting.id, kind, fixed);
      }
      // Сигналим ИИ-панели перечитать отчёты с диска.
      setReportsToken((t) => t + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setApplyingFixes(false);
    }
  };
  const addFix = async () => {
    const from = fixFrom.trim();
    const to = fixTo.trim();
    if (!from || applyingFixes) return;
    const fix: Fix = { from, to };
    const next = [...fixes, fix];
    setFixesState(next);
    persistFixes(meeting.id, next);
    setFixFrom("");
    setFixTo("");
    await applyFixList([fix]);
  };
  const removeFix = (i: number) => {
    const next = fixes.filter((_, j) => j !== i);
    setFixesState(next);
    persistFixes(meeting.id, next);
  };
  const reapplyAll = () => applyFixList(fixes);

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

  // Соло-режим расшифровывает только микрофон одним голосом — выбор числа
  // собеседников не нужен. Вызов передаёт флаг соло в бэкенд.
  const doTranscribe = () => onTranscribe(isSolo ? 1 : speakerCountValue(), isSolo);

  const speakerOptions = isImported ? [2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5, 6, 7, 8];
  const speakerSelect = isSolo ? (
    <span className="solo-badge" title="Заметка для себя — один голос «Я»">
      🎙 Заметка · один голос
    </span>
  ) : (
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
            {!isSolo && (
              <label className="speaker-edit">
                <span>Имя собеседника</span>
                <input
                  className="chip-input"
                  value={nameForSpeaker(labels, "them")}
                  onChange={(e) => updateLabel("them", e.target.value)}
                />
              </label>
            )}
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
            {playing ? (
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1.2" />
                <rect x="14" y="5" width="4" height="14" rx="1.2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.5-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5Z" />
              </svg>
            )}
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
          ) : editing ? (
            <div className="btn-row">
              <button className="btn ghost" onClick={cancelEdit}>
                Отмена
              </button>
              <button
                className="btn primary"
                onClick={saveEdit}
                title="Сохранить правки расшифровки"
              >
                ✓ Сохранить
              </button>
            </div>
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
              <CopyButton
                text={() => transcriptToPlain(transcript!, nameOf)}
                label="📋 Копировать"
                title="Скопировать текст расшифровки без Markdown"
              />
              <button
                className="btn ghost"
                onClick={startEdit}
                title="Исправить ошибки распознавания"
              >
                ✎ Редактировать
              </button>
              {speakerSelect}
              <button
                className="btn ghost"
                onClick={doTranscribe}
                title="Перерасшифровать заново"
              >
                ↻ Заново
              </button>
            </div>
          ) : (
            <div className="btn-row">
              {speakerSelect}
              <button className="btn primary" onClick={doTranscribe}>
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
            transcript={editing ? draft : transcript}
            activeIndex={activeIndex}
            labels={labels}
            onSeek={seek}
            editing={editing}
            speakerOptions={speakers}
            onEditText={editText}
            onEditSpeaker={editSpeaker}
            onDeleteSegment={deleteSegment}
          />
        )}
      </div>

      {fixEnabled && hasTranscript && (
        <div className="card">
          <div className="card-head">
            <h3>Сквозные исправления</h3>
            <span
              className="ai-key-pill"
              title="Единое написание имён, компаний и терминов во всех текстах"
            >
              во всех текстах
            </span>
            <div className="spacer" />
            {fixes.length > 0 && (
              <button
                className="btn ghost"
                onClick={reapplyAll}
                disabled={applyingFixes}
                title="Применить все исправления к расшифровке и ИИ-отчётам заново"
              >
                {applyingFixes ? "Применяю…" : "↻ Применить ко всем"}
              </button>
            )}
          </div>
          <div className="card-body">
            <p className="muted" style={{ marginTop: 0 }}>
              Исправьте написание фамилии, компании или термина один раз — Auris
              заменит его во всей расшифровке и во всех ИИ-отчётах (и в новых
              тоже).
            </p>
            {fixes.length > 0 && (
              <div className="fix-list">
                {fixes.map((f, i) => (
                  <span className="fix-chip" key={`${f.from}-${i}`}>
                    <span className="fix-from">{f.from}</span>
                    <span className="fix-arrow" aria-hidden="true">
                      →
                    </span>
                    <span className="fix-to">{f.to || "—"}</span>
                    <button
                      type="button"
                      onClick={() => removeFix(i)}
                      aria-label={`Убрать исправление ${f.from}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="fix-add">
              <input
                value={fixFrom}
                onChange={(e) => setFixFrom(e.target.value)}
                placeholder="как написано (напр. Иваноф)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") addFix();
                }}
              />
              <span className="fix-arrow" aria-hidden="true">
                →
              </span>
              <input
                value={fixTo}
                onChange={(e) => setFixTo(e.target.value)}
                placeholder="как надо (напр. Иванов)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") addFix();
                }}
              />
              <button
                className="btn primary"
                onClick={addFix}
                disabled={applyingFixes || !fixFrom.trim()}
              >
                {applyingFixes ? "…" : "Исправить везде"}
              </button>
            </div>
          </div>
        </div>
      )}

      <AiPanel
        meeting={meeting}
        onMetaSaved={onMetaSaved}
        refreshToken={reportsToken}
      />
    </div>
  );
}
