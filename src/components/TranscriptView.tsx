import { useEffect, useMemo, useRef } from "react";
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

// Палитра для подписей говорящих (для импортированных записей с диаризацией).
const PALETTE = ["#5ee0d0", "#6ea8fe", "#f0a868", "#c792ea", "#7ee787", "#ff9ec7"];

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

  // Порядок появления говорящих → стабильный цвет подписи.
  const speakerOrder = useMemo(
    () =>
      transcript
        ? Array.from(new Set(transcript.segments.map((s) => s.speaker)))
        : [],
    [transcript],
  );
  const colorFor = (id: string): string => {
    const i = speakerOrder.indexOf(id);
    return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
  };

  if (!transcript || transcript.segments.length === 0) {
    return <div className="transcript-empty">Расшифровки пока нет.</div>;
  }

  return (
    <div className="transcript">
      {transcript.segments.map((seg, i) => {
        const active = i === activeIndex;
        // "me" — справа (синий), остальные говорящие — слева (как «собеседник»).
        const side = seg.speaker === "me" ? "me" : "them";
        return (
          <div
            key={i}
            ref={active ? activeRef : undefined}
            className={`turn ${side}${active ? " active" : ""}`}
          >
            <span
              className="who"
              style={side === "them" ? { color: colorFor(seg.speaker) } : undefined}
            >
              {nameForSpeaker(labels, seg.speaker)}
            </span>
            <div
              className="bubble"
              onClick={() => onSeek(seg.start_secs)}
              title="Перейти к этому моменту"
            >
              {seg.text}
            </div>
            <span className="stamp">{clock(seg.start_secs)}</span>
          </div>
        );
      })}
    </div>
  );
}
