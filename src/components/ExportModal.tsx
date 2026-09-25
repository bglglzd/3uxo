import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import type { Meeting, ReportKind, Transcript } from "../types";
import { api } from "../api";
import {
  buildDocumentMd,
  buildDocumentTxt,
  safeFileName,
  transcriptToSrt,
} from "../export";
import type { DocReport, NameOf } from "../export";
import { markdownToDocx, toBase64 } from "../docx";
import { REPORT_ORDER, REPORT_META } from "../reports";

type Format = "docx" | "md" | "txt" | "srt";

const FORMATS: { id: Format; title: string; hint: string }[] = [
  { id: "docx", title: "Word", hint: ".docx — открыть, поправить, отправить" },
  { id: "md", title: "Markdown", hint: ".md — для Obsidian, Notion, GitHub" },
  { id: "txt", title: "Текст", hint: ".txt — без разметки, куда угодно" },
  { id: "srt", title: "Субтитры", hint: ".srt — реплики с точным временем для видео" },
];

interface Props {
  meeting: Meeting;
  transcript: Transcript | null;
  reports: Partial<Record<ReportKind, string>>;
  nameOf: NameOf;
  onClose: () => void;
}

/// Экспорт встречи: один документ, в который можно сложить стенограмму и
/// любые готовые ИИ-отчёты, в нужном формате.
export function ExportModal({ meeting, transcript, reports, nameOf, onClose }: Props) {
  const available = REPORT_ORDER.filter((k) => reports[k]);
  const [format, setFormat] = useState<Format>("docx");
  const [withTranscript, setWithTranscript] = useState(!!transcript);
  const [timecodes, setTimecodes] = useState(true);
  const [picked, setPicked] = useState<ReportKind[]>(available);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isSrt = format === "srt";
  const toggle = (k: ReportKind) =>
    setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const nothing = isSrt ? !transcript : !withTranscript && picked.length === 0;

  const doExport = async () => {
    setError("");
    setBusy(true);
    try {
      const parts = {
        transcript,
        includeTranscript: withTranscript,
        timecodes,
        reports: REPORT_ORDER.filter((k) => picked.includes(k) && reports[k]).map(
          (k): DocReport => ({ title: REPORT_META[k].title, markdown: reports[k] ?? "" }),
        ),
      };
      const path = await save({
        defaultPath: safeFileName(meeting, format),
        filters: [{ name: FORMATS.find((f) => f.id === format)!.title, extensions: [format] }],
      });
      if (!path) return;
      if (format === "docx") {
        const md = buildDocumentMd(meeting, parts, nameOf, false);
        await api.saveBinaryFile(path, toBase64(markdownToDocx(md, meeting.title || "Встреча")));
      } else if (format === "md") {
        await api.saveTextFile(path, buildDocumentMd(meeting, parts, nameOf));
      } else if (format === "txt") {
        await api.saveTextFile(path, buildDocumentTxt(meeting, parts, nameOf));
      } else if (transcript) {
        await api.saveTextFile(path, transcriptToSrt(transcript, nameOf));
      }
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal export-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Экспорт</h2>
        <p className="lead">Соберите один документ: стенограмма и нужные ИИ-отчёты.</p>

        <div className="field">
          <label>Формат</label>
          <div className="format-grid">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={format === f.id ? "format-card on" : "format-card"}
                onClick={() => setFormat(f.id)}
                aria-pressed={format === f.id}
              >
                <span className="format-title">{f.title}</span>
                <span className="format-hint">{f.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {isSrt ? (
          <p className="hint">Субтитры содержат только реплики расшифровки.</p>
        ) : (
          <div className="field">
            <label>Что включить</label>
            <div className="export-picks">
              {available.map((k) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={picked.includes(k)} onChange={() => toggle(k)} />
                  {REPORT_META[k].icon} {REPORT_META[k].title}
                </label>
              ))}
              <label className="check">
                <input
                  type="checkbox"
                  checked={withTranscript}
                  disabled={!transcript}
                  onChange={(e) => setWithTranscript(e.target.checked)}
                />
                📝 Стенограмма
              </label>
              {withTranscript && (
                <label className="check sub">
                  <input
                    type="checkbox"
                    checked={timecodes}
                    onChange={(e) => setTimecodes(e.target.checked)}
                  />
                  с таймкодами
                </label>
              )}
              {available.length === 0 && (
                <span className="hint">
                  ИИ-отчётов пока нет — их можно создать в блоке «ИИ-ассистент».
                </span>
              )}
            </div>
          </div>
        )}

        {error && <div className="ai-error">{error}</div>}

        <div className="modal-actions">
          <span />
          <div className="modal-actions-btns">
            <button className="btn ghost" onClick={onClose}>
              Отмена
            </button>
            <button className="btn primary" onClick={doExport} disabled={busy || nothing}>
              {busy ? "Сохраняю…" : "Сохранить файл"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
