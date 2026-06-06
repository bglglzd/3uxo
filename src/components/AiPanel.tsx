import { useEffect, useState } from "react";
import type { Meeting } from "../types";
import { api } from "../api";
import { getSettings, isAiConfigured } from "../settings";

interface Props {
  meeting: Meeting;
  onMetaSaved: () => void;
}

export function AiPanel({ meeting, onMetaSaved }: Props) {
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  useEffect(() => {
    setSummary(null);
    setAnswer("");
    api.getSummary(meeting.id).then(setSummary).catch(() => {});
  }, [meeting.id]);

  const aiCfg = () => {
    const s = getSettings();
    if (!isAiConfigured(s)) {
      setError("Заполни настройки ИИ (base URL, ключ, модель) в «Настройки».");
      return null;
    }
    setError("");
    return s.ai;
  };

  const doSuggest = async () => {
    const c = aiCfg();
    if (!c) return;
    setBusy("suggest");
    try {
      const m = await api.suggestMetadata(meeting.id, c);
      await api.updateMeetingMeta(meeting.id, m.title, m.participants, m.topic);
      onMetaSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  const doSummarize = async () => {
    const c = aiCfg();
    if (!c) return;
    setBusy("sum");
    try {
      setSummary(await api.summarize(meeting.id, c));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  const doAsk = async () => {
    const c = aiCfg();
    if (!c) return;
    setBusy("ask");
    try {
      setAnswer(await api.ask(meeting.id, c, question));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>ИИ-ассистент</h3>
        <div className="spacer" />
        <div className="btn-row">
          <button className="btn" onClick={doSuggest} disabled={busy !== ""}>
            {busy === "suggest" ? "…" : "Авто-заголовок"}
          </button>
          <button className="btn" onClick={doSummarize} disabled={busy !== ""}>
            {busy === "sum" ? "Думаю…" : "Сделать выжимку"}
          </button>
        </div>
      </div>
      <div className="card-body">
        {error && <div className="ai-error">{error}</div>}
        {summary ? (
          <div className="summary-text">{summary}</div>
        ) : (
          <p className="muted">Выжимки пока нет — нажми «Сделать выжимку».</p>
        )}
        <div className="ask-row">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Спросить по встрече…"
            onKeyDown={(e) => {
              if (e.key === "Enter") doAsk();
            }}
          />
          <button
            className="btn primary"
            onClick={doAsk}
            disabled={busy !== "" || !question}
          >
            {busy === "ask" ? "…" : "Спросить"}
          </button>
        </div>
        {answer && <div className="ai-answer">{answer}</div>}
      </div>
    </div>
  );
}
