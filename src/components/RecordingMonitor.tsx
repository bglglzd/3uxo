import { useEffect, useRef, useState } from "react";
import type { TrackLevels } from "../types";

interface Props {
  levels: TrackLevels;
  solo: boolean;
  elapsed: number;
}

const HISTORY = 130; // ~8с при опросе 60мс
const POLL_MS = 60;
const SILENCE_THRESH = 0.04; // перцептивная (0..1)
const SILENCE_WARN_SECS = 3;

// Перцептивная шкала: речь выглядит живо, тишина — плоско.
const scale = (v: number) => Math.sqrt(Math.max(0, Math.min(1000, v)) / 1000);

interface TileProps {
  title: string;
  icon: string;
  levels: number[]; // история 0..1, длиной HISTORY
  silenceSecs: number;
  variant: "me" | "peer";
}

function Tile({ title, icon, levels, silenceSecs, variant }: TileProps) {
  const w = HISTORY;
  const h = 40;
  const silent = silenceSecs >= SILENCE_WARN_SECS;
  return (
    <div className={`rec-tile rec-tile--${variant}`}>
      <div className="rec-tile-head">
        <span className="rec-tile-title">
          {icon} {title}
        </span>
        <span className="rec-tile-dot" aria-hidden="true" />
      </div>
      <svg
        className="rec-wave"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {levels.map((v, i) => {
          const barH = Math.max(0.6, v * h);
          return (
            <rect
              key={i}
              x={i}
              y={(h - barH) / 2}
              width={0.85}
              height={barH}
              rx={0.3}
            />
          );
        })}
      </svg>
      <div className="rec-tile-foot">
        {silent ? (
          <span className="rec-warn">⚠ тишина {Math.floor(silenceSecs)} сек</span>
        ) : (
          <span className="rec-ok">● запись</span>
        )}
      </div>
    </div>
  );
}

export function RecordingMonitor({ levels, solo }: Props) {
  const [micHist, setMicHist] = useState<number[]>(() =>
    Array(HISTORY).fill(0),
  );
  const [sysHist, setSysHist] = useState<number[]>(() =>
    Array(HISTORY).fill(0),
  );
  const micSilence = useRef(0);
  const sysSilence = useRef(0);

  useEffect(() => {
    const m = scale(levels.mic);
    const s = scale(levels.system);
    micSilence.current = m < SILENCE_THRESH ? micSilence.current + 1 : 0;
    sysSilence.current = s < SILENCE_THRESH ? sysSilence.current + 1 : 0;
    setMicHist((prev) => [...prev.slice(1), m]);
    setSysHist((prev) => [...prev.slice(1), s]);
  }, [levels]);

  const micSecs = (micSilence.current * POLL_MS) / 1000;
  const sysSecs = (sysSilence.current * POLL_MS) / 1000;

  return (
    <div className="rec-monitor">
      <Tile
        title="Вы"
        icon="🎙"
        levels={micHist}
        silenceSecs={micSecs}
        variant="me"
      />
      {!solo && (
        <Tile
          title="Собеседник"
          icon="🔊"
          levels={sysHist}
          silenceSecs={sysSecs}
          variant="peer"
        />
      )}
    </div>
  );
}
