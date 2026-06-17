import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import type { Meeting } from "../types";
import { api } from "../api";
import { getSettings, isAiConfigured } from "../settings";
import { Markdown } from "./Markdown";

interface Props {
  meeting: Meeting;
  onMetaSaved: () => void;
}

export function AiPanel({ meeting, onMetaSaved }: Props) {
  const [summary, setSummary] = useState<string | null>(null);
  const [literary, setLiterary] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  useEffect(() => {
    setSummary(null);
    setLiterary(null);
    setAnswer("");
    api.getSummary(meeting.id).then(setSummary).catch(() => {});
    api.getLiterary(meeting.id).then(setLiterary).catch(() => {});
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

  const doLiterary = async () => {
    const c = aiCfg();
    if (!c) return;
    setBusy("lit");
    try {
      setLiterary(await api.literaryText(meeting.id, c));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  const doAsk = async () => {
    const c = aiCfg();
    if (!c || busy) return;
    setBusy("ask");
    try {
      setAnswer(await api.ask(meeting.id, c, question));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  // Экспорт текста в файл (.md/.txt) через системный диалог.
  const exportText = async (content: string, suffix: string) => {
    const base =
      (meeting.title || "meeting").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 80) ||
      "meeting";
    try {
      const path = await save({
        defaultPath: `${base} — ${suffix}.md`,
        filters: [
          { name: "Markdown", extensions: ["md"] },
          { name: "Текст", extensions: ["txt"] },
        ],
      });
      if (path) await api.saveTextFile(path, content);
    } catch (e) {
      setError(String(e));
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
            {busy === "sum" ? "Думаю…" : "Выжимка"}
          </button>
          <button className="btn" onClick={doLiterary} disabled={busy !== ""}>
            {busy === "lit" ? "Пишу…" : "Литературный текст"}
          </button>
        </div>
      </div>
      <div className="card-body">
        {error && <div className="ai-error">{error}</div>}

        {summary ? (
          <div className="ai-block">
            <div className="ai-block-head">
              <span className="ai-block-title">Выжимка</span>
              <button
                className="btn ghost"
                onClick={() => exportText(summary, "выжимка")}
              >
                ⬇ Экспорт
              </button>
            </div>
            <div className="summary-text">
              <Markdown>{summary}</Markdown>
            </div>
          </div>
        ) : (
          <p className="muted">Выжимки пока нет — нажми «Выжимка».</p>
        )}

        {literary && (
          <div className="ai-block">
            <div className="ai-block-head">
              <span className="ai-block-title">Литературный текст</span>
              <button
                className="btn ghost"
                onClick={() => exportText(literary, "текст")}
              >
                ⬇ Экспорт
              </button>
            </div>
            <div className="summary-text">
              <Markdown>{literary}</Markdown>
            </div>
          </div>
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
        {answer && (
          <div className="ai-answer">
            <Markdown>{answer}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}
