import { useEffect, useState } from "react";
import type { Meeting } from "../types";
import { api } from "../api";
import { getSettings } from "../settings";

interface Props {
  meeting: Meeting;
  onMetaSaved: () => void;
}

export function AiPanel({ meeting, onMetaSaved }: Props) {
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [title, setTitle] = useState(meeting.title);
  const [participants, setParticipants] = useState(meeting.participants);
  const [topic, setTopic] = useState(meeting.topic);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  useEffect(() => {
    api.getSummary(meeting.id).then(setSummary);
  }, [meeting.id]);

  const requireConfig = () => {
    const c = getSettings();
    if (!c.base_url || !c.api_key || !c.model) {
      setError("Заполни настройки ИИ (base URL, ключ, модель).");
      return null;
    }
    setError("");
    return c;
  };

  const doSummarize = async () => {
    const c = requireConfig();
    if (!c) return;
    setBusy("summary");
    try {
      setSummary(await api.summarize(meeting.id, c));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  const doSuggest = async () => {
    const c = requireConfig();
    if (!c) return;
    setBusy("suggest");
    try {
      const s = await api.suggestMetadata(meeting.id, c);
      setTitle(s.title);
      setParticipants(s.participants);
      setTopic(s.topic);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  const saveMeta = async () => {
    setBusy("save");
    try {
      await api.updateMeetingMeta(meeting.id, title, participants, topic);
      onMetaSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  const doAsk = async () => {
    const c = requireConfig();
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
    <section className="ai-panel">
      {error && <p className="ai-error">{error}</p>}

      <div className="ai-meta">
        <h3>Метаданные</h3>
        <label>
          Заголовок
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Участники
          <input
            value={participants}
            onChange={(e) => setParticipants(e.target.value)}
          />
        </label>
        <label>
          Тема
          <input value={topic} onChange={(e) => setTopic(e.target.value)} />
        </label>
        <div className="ai-actions">
          <button onClick={doSuggest} disabled={busy !== ""}>
            {busy === "suggest" ? "…" : "ИИ: предложить"}
          </button>
          <button onClick={saveMeta} disabled={busy !== ""}>
            Сохранить
          </button>
        </div>
      </div>

      <div className="ai-summary">
        <h3>Выжимка</h3>
        {summary ? (
          <pre className="summary-text">{summary}</pre>
        ) : (
          <p className="muted">Выжимки пока нет.</p>
        )}
        <button onClick={doSummarize} disabled={busy !== ""}>
          {busy === "summary" ? "Думаю…" : "Сделать выжимку"}
        </button>
      </div>

      <div className="ai-chat">
        <h3>Вопрос по встрече</h3>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Спросить…"
        />
        <button onClick={doAsk} disabled={busy !== "" || !question}>
          {busy === "ask" ? "…" : "Спросить"}
        </button>
        {answer && <p className="ai-answer">{answer}</p>}
      </div>
    </section>
  );
}
