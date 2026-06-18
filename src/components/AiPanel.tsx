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
  const [brief, setBrief] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [literary, setLiterary] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  useEffect(() => {
    setBrief(null);
    setSummary(null);
    setAnalysis(null);
    setLiterary(null);
    setAnswer("");
    api.getBrief(meeting.id).then(setBrief).catch(() => {});
    api.getSummary(meeting.id).then(setSummary).catch(() => {});
    api.getAnalysis(meeting.id).then(setAnalysis).catch(() => {});
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

  // Запускает ИИ-действие под ключом `key`, складывая результат через `set`.
  const run = async (
    key: string,
    fn: (id: string, cfg: ReturnType<typeof getSettings>["ai"]) => Promise<string>,
    set?: (v: string) => void,
  ) => {
    const c = aiCfg();
    if (!c || busy) return;
    setBusy(key);
    try {
      const res = await fn(meeting.id, c);
      if (set) set(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  const doSuggest = async () => {
    const c = aiCfg();
    if (!c || busy) return;
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

  const block = (title: string, content: string | null, suffix: string) =>
    content ? (
      <div className="ai-block">
        <div className="ai-block-head">
          <span className="ai-block-title">{title}</span>
          <button className="btn ghost" onClick={() => exportText(content, suffix)}>
            ⬇ Экспорт
          </button>
        </div>
        <div className="summary-text">
          <Markdown>{content}</Markdown>
        </div>
      </div>
    ) : null;

  const nothing = !brief && !summary && !analysis && !literary;

  return (
    <div className="card">
      <div className="card-head">
        <h3>ИИ-ассистент</h3>
        <span className="ai-key-pill" title="ИИ-функции работают через ваш API-ключ">
          ИИ · ваш ключ
        </span>
        <div className="spacer" />
        <div className="btn-row">
          <button className="btn" onClick={doSuggest} disabled={busy !== ""}>
            {busy === "suggest" ? "…" : "Авто-заголовок"}
          </button>
          <button
            className="btn"
            onClick={() => run("brief", api.briefSummary, setBrief)}
            disabled={busy !== ""}
          >
            {busy === "brief" ? "…" : "Краткое резюме"}
          </button>
          <button
            className="btn"
            onClick={() => run("sum", api.summarize, setSummary)}
            disabled={busy !== ""}
          >
            {busy === "sum" ? "Думаю…" : "Выжимка"}
          </button>
          <button
            className="btn"
            onClick={() => run("analyze", api.analyze, setAnalysis)}
            disabled={busy !== ""}
          >
            {busy === "analyze" ? "Анализ…" : "ИИ-анализ"}
          </button>
          <button
            className="btn"
            onClick={() => run("lit", api.literaryText, setLiterary)}
            disabled={busy !== ""}
          >
            {busy === "lit" ? "Пишу…" : "Литературный текст"}
          </button>
        </div>
      </div>
      <div className="card-body">
        {error && <div className="ai-error">{error}</div>}

        {nothing && (
          <p className="muted">
            Выбери, что построить по встрече: краткое резюме, выжимку, ИИ-анализ
            или литературный текст.
          </p>
        )}

        {block("Краткое резюме", brief, "резюме")}
        {block("Выжимка", summary, "выжимка")}
        {block("ИИ-анализ", analysis, "анализ")}
        {block("Литературный текст", literary, "текст")}

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
