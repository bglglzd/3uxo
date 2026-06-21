import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import type { Meeting, ReportKind } from "../types";
import { api } from "../api";
import { getSettings, isAiConfigured } from "../settings";
import { stripMarkdown } from "../export";
import { Markdown } from "./Markdown";
import { CopyButton } from "./CopyButton";

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
  // Правка ИИ-отчёта: какой блок редактируется и его черновик.
  const [editKind, setEditKind] = useState<ReportKind | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBrief(null);
    setSummary(null);
    setAnalysis(null);
    setLiterary(null);
    setAnswer("");
    setEditKind(null);
    api.getBrief(meeting.id).then(setBrief).catch(() => {});
    api.getSummary(meeting.id).then(setSummary).catch(() => {});
    api.getAnalysis(meeting.id).then(setAnalysis).catch(() => {});
    api.getLiterary(meeting.id).then(setLiterary).catch(() => {});
  }, [meeting.id]);

  const startEdit = (kind: ReportKind, content: string) => {
    setError("");
    setEditKind(kind);
    setDraft(content);
  };
  const saveEdit = async (kind: ReportKind, set: (v: string) => void) => {
    setSaving(true);
    try {
      await api.saveReport(meeting.id, kind, draft);
      set(draft);
      setEditKind(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

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

  const block = (
    title: string,
    content: string | null,
    suffix: string,
    kind: ReportKind,
    set: (v: string) => void,
  ) => {
    if (!content) return null;
    const isEditing = editKind === kind;
    return (
      <div className="ai-block">
        <div className="ai-block-head">
          <span className="ai-block-title">{title}</span>
          {isEditing ? (
            <div className="btn-row">
              <button
                className="btn ghost"
                onClick={() => setEditKind(null)}
                disabled={saving}
              >
                Отмена
              </button>
              <button
                className="btn primary"
                onClick={() => saveEdit(kind, set)}
                disabled={saving}
                title="Сохранить правки отчёта"
              >
                {saving ? "…" : "✓ Сохранить"}
              </button>
            </div>
          ) : (
            <div className="btn-row">
              <CopyButton
                text={() => stripMarkdown(content)}
                label="📋 Копировать"
                title="Скопировать как обычный текст, без Markdown"
              />
              <button
                className="btn ghost"
                onClick={() => startEdit(kind, content)}
                title="Исправить текст отчёта"
              >
                ✎ Редактировать
              </button>
              <button className="btn ghost" onClick={() => exportText(content, suffix)}>
                ⬇ Экспорт
              </button>
            </div>
          )}
        </div>
        {isEditing ? (
          <textarea
            className="ai-edit"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(24, Math.max(6, draft.split("\n").length + 1))}
          />
        ) : (
          <div className="summary-text">
            <Markdown>{content}</Markdown>
          </div>
        )}
      </div>
    );
  };

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

        {block("Краткое резюме", brief, "резюме", "brief", setBrief)}
        {block("Выжимка", summary, "выжимка", "summary", setSummary)}
        {block("ИИ-анализ", analysis, "анализ", "analysis", setAnalysis)}
        {block("Литературный текст", literary, "текст", "literary", setLiterary)}

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
            <div className="ai-block-head">
              <span className="ai-block-title">Ответ</span>
              <CopyButton
                text={() => stripMarkdown(answer)}
                label="📋 Копировать"
                title="Скопировать ответ как обычный текст, без Markdown"
              />
            </div>
            <Markdown>{answer}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}
