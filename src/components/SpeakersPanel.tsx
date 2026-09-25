import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Transcript } from "../types";
import type { SpeakerLabels } from "../labels";
import { defaultName, nameForSpeaker } from "../labels";
import { speakerStats } from "../speakers";
import { clock } from "../export";

interface Props {
  transcript: Transcript;
  labels: SpeakerLabels;
  /// Записанная встреча: «Я» — микрофон, остальные — собеседники.
  recorded: boolean;
  /// Текущий выбор числа голосов: "auto" | "1".."8".
  count: string;
  /// Есть сохранённый анализ голосов — число можно менять мгновенно.
  canRecluster: boolean;
  busy: boolean;
  onRename: (id: string, name: string) => void;
  onCount: (value: string) => void;
  onMerge: (from: string, into: string) => void;
  onPlaySample: (start: number, end: number) => void;
}

const COUNTS = ["auto", "1", "2", "3", "4", "5", "6"];

/// Панель «Голоса»: кто говорил и сколько, имена, прослушать образец голоса,
/// объединить ошибочно разделённые голоса и поменять их число — без повторной
/// расшифровки.
export function SpeakersPanel({
  transcript,
  labels,
  recorded,
  count,
  canRecluster,
  busy,
  onRename,
  onCount,
  onMerge,
  onPlaySample,
}: Props) {
  const stats = useMemo(() => speakerStats(transcript), [transcript]);
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);
  const order = stats.map((s) => s.id);
  const colorOf = (id: string) => `var(--spk-${Math.max(0, order.indexOf(id)) % 6})`;
  const others = stats.filter((s) => s.id !== "me");
  const found = others.length;

  const countLabel = (v: string) => (v === "auto" ? "Авто" : v);
  const who = recorded ? "Собеседников" : "Голосов";

  return (
    <div className="voices">
      <div className="voices-head">
        <div>
          <div className="voices-title">Голоса</div>
          <div className="hint">
            {recorded
              ? `«Я» — ваш микрофон. Собеседников найдено: ${found}.`
              : `Найдено голосов: ${found}.`}{" "}
            Послушайте образец и подпишите — имена попадут в текст, экспорт и
            ИИ-отчёты.
          </div>
        </div>
        <div className="voices-count" role="group" aria-label={who}>
          <span className="voices-count-label">{who}:</span>
          {COUNTS.map((v) => (
            <button
              key={v}
              type="button"
              className={v === count ? "seg-btn on" : "seg-btn"}
              disabled={busy}
              onClick={() => onCount(v)}
              title={
                v === "auto"
                  ? "Определить число голосов автоматически"
                  : canRecluster
                    ? `Разделить ровно на ${v} — мгновенно, текст не меняется`
                    : `Применится при следующей расшифровке`
              }
            >
              {countLabel(v)}
            </button>
          ))}
        </div>
      </div>

      <div className="voices-list">
        {stats.map((s) => {
          const name = nameForSpeaker(labels, s.id);
          const mergeTargets = stats.filter((o) => o.id !== s.id && o.id !== "me");
          return (
            <div className="voice-row" key={s.id}>
              <span className="voice-dot" style={{ background: colorOf(s.id) } as CSSProperties} />
              <input
                className="chip-input voice-name"
                value={labels[s.id] ?? ""}
                placeholder={defaultName(s.id)}
                onChange={(e) => onRename(s.id, e.target.value)}
                aria-label={`Имя: ${name}`}
              />
              <div className="voice-bar" title={`${Math.round(s.share * 100)}% речи`}>
                <span
                  style={
                    {
                      width: `${Math.max(2, Math.round(s.share * 100))}%`,
                      background: colorOf(s.id),
                    } as CSSProperties
                  }
                />
              </div>
              <span className="voice-meta">
                {Math.round(s.share * 100)}% · {clock(s.secs)}
              </span>
              <button
                type="button"
                className="btn ghost voice-play"
                onClick={() => onPlaySample(s.sample.start, s.sample.end)}
                title={`Послушать: «${s.sample.text.slice(0, 80)}»`}
              >
                ▶ Образец
              </button>
              {(s.id === "me" || mergeTargets.length === 0) && <span />}
              {s.id !== "me" && mergeTargets.length > 0 && (
                mergeFrom === s.id ? (
                  <select
                    className="voice-merge"
                    autoFocus
                    defaultValue=""
                    disabled={busy}
                    onBlur={() => setMergeFrom(null)}
                    onChange={(e) => {
                      if (e.target.value) onMerge(s.id, e.target.value);
                      setMergeFrom(null);
                    }}
                  >
                    <option value="" disabled>
                      Это тот же человек, что…
                    </option>
                    {mergeTargets.map((o) => (
                      <option key={o.id} value={o.id}>
                        {nameForSpeaker(labels, o.id)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => setMergeFrom(s.id)}
                    title="Если один человек разделился на два голоса — объедините их"
                  >
                    ⤵ Объединить
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
