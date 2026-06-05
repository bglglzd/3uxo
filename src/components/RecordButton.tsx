interface Props {
  recording: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function RecordButton({ recording, onStart, onStop }: Props) {
  return (
    <button
      className={recording ? "rec-btn recording" : "rec-btn"}
      onClick={recording ? onStop : onStart}
    >
      {recording ? "⏹ Остановить" : "⏺ Начать запись"}
    </button>
  );
}
