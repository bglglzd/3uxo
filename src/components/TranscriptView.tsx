import { useEffect, useRef } from "react";
import type { Transcript } from "../types";
import type { SpeakerLabels } from "../labels";
import { clock } from "../export";

interface Props {
  transcript: Transcript | null;
  activeIndex: number;
  labels: SpeakerLabels;
  onSeek: (secs: number) => void;
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

  if (!transcript || transcript.segments.length === 0) {
    return <div className="transcript-empty">Расшифровки пока нет.</div>;
  }

  return (
    <div className="transcript">
      {transcript.segments.map((seg, i) => {
        const active = i === activeIndex;
        return (
          <div
            key={i}
            ref={active ? activeRef : undefined}
            className={`turn ${seg.speaker}${active ? " active" : ""}`}
          >
            <span className="who">
              {seg.speaker === "me" ? labels.me : labels.them}
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
