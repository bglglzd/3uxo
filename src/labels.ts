/// Имена говорящих, заданные пользователем для конкретной встречи.
/// Ключ — id говорящего ("me"/"them"/"spk0"…), значение — отображаемое имя.
export type SpeakerLabels = Record<string, string>;

/// Имя говорящего по умолчанию (если пользователь не переименовал).
/// "me"→«Я», "them"→«Собеседник», "spkN"→«Спикер N+1», иначе сам id.
export function defaultName(id: string): string {
  if (id === "me") return "Я";
  if (id === "them") return "Собеседник";
  const m = /^spk(\d+)$/.exec(id);
  if (m) return `Спикер ${Number(m[1]) + 1}`;
  return id;
}

export function getLabels(meetingId: string): SpeakerLabels {
  try {
    const raw = localStorage.getItem(`3uxo.labels.${meetingId}`);
    if (raw) return JSON.parse(raw) as SpeakerLabels;
  } catch {
    /* ignore */
  }
  return {};
}

export function setLabels(meetingId: string, labels: SpeakerLabels): void {
  localStorage.setItem(`3uxo.labels.${meetingId}`, JSON.stringify(labels));
}

/// Отображаемое имя говорящего: пользовательское (если задано непустым) или дефолт.
export function nameForSpeaker(labels: SpeakerLabels, id: string): string {
  const custom = labels[id]?.trim();
  return custom ? custom : defaultName(id);
}
