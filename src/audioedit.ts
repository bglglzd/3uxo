import type { AudioRange } from "./types";

/// Вырез на таймлайне: полуинтервал [start, end) в секундах.
/// Внутри редактора считаем в коротких полях, на границе с бэкендом
/// переводим в `AudioRange` (`toRanges`).
export interface Cut {
  start: number;
  end: number;
}

/// Короче этого (сек) выделение считается щелчком, а не протяжкой.
export const MIN_CUT_SECS = 0.02;

/// Упорядочивает две точки в вырез (протяжка возможна в любую сторону) и
/// зажимает его в [0, duration].
export function normalizeCut(a: number, b: number, duration: number): Cut {
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(duration, Math.max(a, b));
  return { start: lo, end: Math.max(lo, hi) };
}

/// Канонический вид набора вырезов: без пустых, по возрастанию, склеенные.
export function mergeCuts(cuts: Cut[]): Cut[] {
  const sorted = cuts
    .filter((c) => c.end - c.start > 0)
    .map((c) => ({ start: Math.max(0, c.start), end: Math.max(0, c.end) }))
    .sort((a, b) => a.start - b.start);
  const out: Cut[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.start <= last.end) {
      if (c.end > last.end) last.end = c.end;
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

/// Сколько всего секунд вырезано.
export function cutsTotal(cuts: Cut[]): number {
  return mergeCuts(cuts).reduce((sum, c) => sum + (c.end - c.start), 0);
}

/// Длительность записи после применения вырезов.
export function keptDuration(duration: number, cuts: Cut[]): number {
  return Math.max(0, duration - cutsTotal(cuts));
}

/// «Оставить только выделенное» = вырезать всё вне интервала `keep`.
export function invertCuts(duration: number, keep: Cut): Cut[] {
  const inner = normalizeCut(keep.start, keep.end, duration);
  const out: Cut[] = [];
  if (inner.start > 0) out.push({ start: 0, end: inner.start });
  if (inner.end < duration) out.push({ start: inner.end, end: duration });
  return out;
}

/// Куда перескочить при предпрослушивании, если точка `t` попала в вырез;
/// `null` — точка звучит и прыгать не нужно.
export function skipTarget(t: number, cuts: Cut[]): number | null {
  for (const c of mergeCuts(cuts)) {
    if (t >= c.start && t < c.end) return c.end;
  }
  return null;
}

/// Индекс выреза, накрывающего точку `t` (−1, если такого нет).
export function cutIndexAt(cuts: Cut[], t: number): number {
  return cuts.findIndex((c) => t >= c.start && t < c.end);
}

/// Убирает вырез под точкой `t` (снять один вырез, не трогая остальные).
export function removeCutAt(cuts: Cut[], t: number): Cut[] {
  const i = cutIndexAt(cuts, t);
  return i < 0 ? cuts : cuts.filter((_, j) => j !== i);
}

/// Сжимает карту громкости до `target` столбцов методом максимума — пики
/// (щелчки, всплески) не теряются, в отличие от усреднения.
export function downsample(values: number[], target: number): number[] {
  if (target <= 0 || values.length === 0) return [];
  if (values.length <= target) return values.slice();
  const out: number[] = new Array(target);
  for (let i = 0; i < target; i++) {
    const from = Math.floor((i * values.length) / target);
    const to = Math.max(from + 1, Math.floor(((i + 1) * values.length) / target));
    let max = 0;
    for (let j = from; j < to && j < values.length; j++) {
      if (values[j] > max) max = values[j];
    }
    out[i] = max;
  }
  return out;
}

/// Время с десятыми: 83.42 → «1:23.4». Для точных границ выреза.
export function clockPrecise(secs: number): string {
  const safe = Math.max(0, secs);
  const m = Math.floor(safe / 60);
  const s = safe - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/// Разбор введённого времени: «1:23.4», «83.4», «1:23». `null` — не время.
export function parseClock(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length > 2) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const secs = parts.length === 2 ? nums[0] * 60 + nums[1] : nums[0];
  return Number.isFinite(secs) ? secs : null;
}

/// Вырезы редактора → интервалы для бэкенда (канонизированные).
export function toRanges(cuts: Cut[]): AudioRange[] {
  return mergeCuts(cuts).map((c) => ({ start_secs: c.start, end_secs: c.end }));
}

/// Человеческие шаги линейки времени — чтобы подписи были «круглыми».
const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

/// Шаг линейки: примерно по подписи на 120 px, с учётом зума.
export function rulerStep(duration: number, zoom: number): number {
  const wanted = duration / Math.max(1, 8 * zoom);
  return RULER_STEPS.find((s) => s >= wanted) ?? RULER_STEPS[RULER_STEPS.length - 1];
}

/// Отметки линейки от 0 до конца записи с шагом `step` (без самого конца —
/// подпись у правого края обрезалась бы).
export function rulerTicks(duration: number, step: number): number[] {
  if (duration <= 0 || step <= 0) return [];
  const out: number[] = [];
  for (let t = 0; t < duration - step * 0.35; t += step) out.push(t);
  return out;
}

/// Путь зеркальной волны в системе viewBox `0 0 N 100`: сверху по столбцам,
/// снизу — обратно, замкнуто. Значения — громкость 0..1000.
export function wavePath(values: number[]): string {
  if (values.length === 0) return "";
  const full = 92; // высота на максимуме: волна не липнет к краям дорожки
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const h = (Math.max(0, Math.min(1000, values[i])) / 1000) * full;
    top.push(`${i} ${(50 - h / 2).toFixed(2)}`);
    bottom.push(`${i} ${(50 + h / 2).toFixed(2)}`);
  }
  bottom.reverse();
  return `M ${top.join(" L ")} L ${bottom.join(" L ")} Z`;
}
