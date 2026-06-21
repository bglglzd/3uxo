import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import type { Transcript } from "../types";
import type { SpeakerLabels } from "../labels";
import { nameForSpeaker } from "../labels";
import { clock } from "../export";

interface Props {
  transcript: Transcript | null;
  activeIndex: number;
  labels: SpeakerLabels;
  onSeek: (secs: number) => void;
  /// Режим правки: реплики становятся редактируемыми.
  editing?: boolean;
  /// Доступные id говорящих для переназначения (в режиме правки).
  speakerOptions?: string[];
  onEditText?: (index: number, text: string) => void;
  onEditSpeaker?: (index: number, speaker: string) => void;
  onDeleteSegment?: (index: number) => void;
}

/// Инициалы для аватара спикера: 1–2 буквы из имени.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function TranscriptView({
  transcript,
  activeIndex,
  labels,
  onSeek,
  editing = false,
  speakerOptions = [],
  onEditText,
  onEditSpeaker,
  onDeleteSegment,
}: Props) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing) return;
    const el = activeRef.current;
    if (!el) return;
    try {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } catch {
      // jsdom / unsupported — ignore
    }
  }, [activeIndex, editing]);

  // Порядок появления говорящих → стабильный цвет аватара.
  const speakerOrder = useMemo(
    () =>
      transcript
        ? Array.from(new Set(transcript.segments.map((s) => s.speaker)))
        : [],
    [transcript],
  );
  const speakerIdx = (id: string): number => {
    const i = speakerOrder.indexOf(id);
    return (i < 0 ? 0 : i) % 6;
  };

  if (!transcript || transcript.segments.length === 0) {
    return <div className="transcript-empty">Расшифровки пока нет.</div>;
  }

  return (
    <div className={editing ? "transcript editing" : "transcript"}>
      {transcript.segments.map((seg, i) => {
        const active = i === activeIndex;
        const name = nameForSpeaker(labels, seg.speaker);
        const idx = speakerIdx(seg.speaker);
        return (
          <div
            key={i}
            ref={!editing && active ? activeRef : undefined}
            className={`turn${!editing && active ? " active" : ""}`}
            onClick={editing ? undefined : () => onSeek(seg.start_secs)}
            title={editing ? undefined : "Перейти к этому моменту"}
          >
            <span
              className="turn-avatar"
              style={{ background: `var(--spk-${idx})` } as CSSProperties}
            >
              {initials(name)}
            </span>
            <div className="turn-body">
              <div className="turn-meta">
                {editing && speakerOptions.length > 1 ? (
                  <select
                    className="turn-speaker-sel"
                    value={seg.speaker}
                    onChange={(e) => onEditSpeaker?.(i, e.target.value)}
                    title="Кто говорит"
                  >
                    {speakerOptions.map((sp) => (
                      <option key={sp} value={sp}>
                        {nameForSpeaker(labels, sp)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="turn-name">{name}</span>
                )}
                <span className="turn-time">{clock(seg.start_secs)}</span>
                {editing && (
                  <button
                    type="button"
                    className="turn-del"
                    onClick={() => onDeleteSegment?.(i)}
                    title="Удалить реплику"
                  >
                    🗑
                  </button>
                )}
              </div>
              {editing ? (
                <textarea
                  className="turn-edit"
                  value={seg.text}
                  rows={Math.max(1, Math.ceil(seg.text.length / 60))}
                  onChange={(e) => onEditText?.(i, e.target.value)}
                />
              ) : (
                <div className="turn-text">{seg.text}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
