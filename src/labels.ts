export interface SpeakerLabels {
  me: string;
  them: string;
}

const DEFAULTS: SpeakerLabels = { me: "Я", them: "Собеседник" };

export function defaultLabels(): SpeakerLabels {
  return { ...DEFAULTS };
}

export function getLabels(meetingId: string): SpeakerLabels {
  try {
    const raw = localStorage.getItem(`3uxo.labels.${meetingId}`);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

export function setLabels(meetingId: string, labels: SpeakerLabels): void {
  localStorage.setItem(`3uxo.labels.${meetingId}`, JSON.stringify(labels));
}
