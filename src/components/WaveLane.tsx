import { useMemo } from "react";
import { downsample, wavePath } from "../audioedit";

interface Props {
  /// Подпись дорожки: «Я», «Собеседник», «Запись».
  name: string;
  /// Карта громкости: пик — ореол, RMS — тело волны (0..1000).
  peaks: number[];
  rms: number[];
  /// Сколько столбцов рисовать (растёт с зумом, ограничено данными).
  cols: number;
  /// Цвет дорожки: своя — как аватар «Я», собеседник — как аватар С2.
  tone: "me" | "peer" | "single";
  loading?: boolean;
}

/// Одна дорожка аудио-редактора: подпись + зеркальная волна громкости.
/// Волна рисуется двумя слоями — пик (полупрозрачный ореол) и RMS (тело),
/// поэтому на глаз видно и всплески, и где идёт ровная речь.
export function WaveLane({ name, peaks, rms, cols, tone, loading }: Props) {
  const view = useMemo(() => {
    const n = Math.max(1, Math.min(cols, peaks.length || cols));
    return {
      n,
      peak: wavePath(downsample(peaks, n)),
      body: wavePath(downsample(rms, n)),
    };
  }, [peaks, rms, cols]);

  return (
    <div className={`ae-lane ae-lane--${tone}`}>
      <span className="ae-lane-name">{name}</span>
      {loading || peaks.length === 0 ? (
        <div className="ae-lane-skeleton" aria-hidden="true" />
      ) : (
        <svg
          className="ae-wave"
          viewBox={`0 0 ${view.n} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line
            className="ae-wave-mid"
            x1="0"
            y1="50"
            x2={view.n}
            y2="50"
            vectorEffect="non-scaling-stroke"
          />
          <path className="ae-wave-peak" d={view.peak} />
          <path className="ae-wave-body" d={view.body} />
        </svg>
      )}
    </div>
  );
}
