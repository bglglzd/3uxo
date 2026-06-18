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
}

/// Инициалы для аватара спикера: 1–2 буквы из имени.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function TranscriptView({ transcript, activeIndex, labels, onSeek }: Props) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    try {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } catch {
      // jsdom / unsupported — ignore
    }
  }, [activeIndex]);

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
    <div className="transcript">
      {transcript.segments.map((seg, i) => {
        const active = i === activeIndex;
        const name = nameForSpeaker(labels, seg.speaker);
        const idx = speakerIdx(seg.speaker);
        return (
          <div
            key={i}
            ref={active ? activeRef : undefined}
            className={`turn${active ? " active" : ""}`}
            onClick={() => onSeek(seg.start_secs)}
            title="Перейти к этому моменту"
          >
            <span
              className="turn-avatar"
              style={{ background: `var(--spk-${idx})` } as CSSProperties}
            >
              {initials(name)}
            </span>
            <div className="turn-body">
              <div className="turn-meta">
                <span className="turn-name">{name}</span>
                <span className="turn-time">{clock(seg.start_secs)}</span>
              </div>
              <div className="turn-text">{seg.text}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
