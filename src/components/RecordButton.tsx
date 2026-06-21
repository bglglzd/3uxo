import { formatClock } from "../util";

interface Props {
  recording: boolean;
  paused?: boolean;
  elapsed?: number;
  onStart: () => void;
  onStop: () => void;
  onPause?: () => void;
  onResume?: () => void;
}

export function RecordButton({
  recording,
  paused = false,
  elapsed = 0,
  onStart,
  onStop,
  onPause,
  onResume,
}: Props) {
  if (!recording) {
    return (
      <button className="record" onClick={onStart}>
        <span className="rec-glyph dot" />
        Начать запись
      </button>
    );
  }

  return (
    <div className="record-controls">
      <button
        className={paused ? "record is-paused" : "record is-recording"}
        onClick={onStop}
      >
        <span className="rec-glyph stop" />
        {paused ? "На паузе — завершить" : "Завершить запись"}
        <span className="timer">{formatClock(elapsed)}</span>
      </button>
      <button
        className="record-pause"
        onClick={paused ? onResume : onPause}
        title={paused ? "Продолжить запись" : "Поставить запись на паузу"}
      >
        {paused ? "▶ Продолжить" : "⏸ Пауза"}
      </button>
    </div>
  );
}
