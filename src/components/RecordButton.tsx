import { formatClock } from "../util";

interface Props {
  recording: boolean;
  elapsed?: number;
  onStart: () => void;
  onStop: () => void;
}

export function RecordButton({ recording, elapsed = 0, onStart, onStop }: Props) {
  return (
    <button
      className={recording ? "record is-recording" : "record"}
      onClick={recording ? onStop : onStart}
    >
      <span className={recording ? "rec-glyph stop" : "rec-glyph dot"} />
      {recording ? "Завершить запись" : "Начать запись"}
      {recording && <span className="timer">{formatClock(elapsed)}</span>}
    </button>
  );
}
