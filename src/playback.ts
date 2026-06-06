import type { TranscriptSegment } from "./types";

/// Индекс активной реплики для момента времени `t` (секунды).
/// Если `t` попадает внутрь реплики — её индекс. Если в паузе между
/// репликами — последняя уже начавшаяся (чтобы подсветка не «мигала»).
/// Возвращает -1, если ни одна реплика ещё не началась.
export function activeSegmentIndex(
  segments: TranscriptSegment[],
  t: number,
): number {
  let idx = -1;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (t >= s.start_secs && t < s.end_secs) return i;
    if (s.start_secs <= t) idx = i;
    else break;
  }
  return idx;
}
