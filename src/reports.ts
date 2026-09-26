import type { ReportKind } from "./types";

/// Описание ИИ-отчёта для интерфейса. Набор выстроен по задачам без
/// пересечений: «что решили» (Итоги), «кому что делать» (Задачи), «как шёл
/// разговор» (Разбор), «весь текст начисто» (Чистовой), «отправить
/// участникам» (Письмо).
export interface ReportMeta {
  title: string;
  icon: string;
  /// Одна строка: что получится и когда это нужно.
  what: string;
  /// Надпись на кнопке во время генерации.
  busy: string;
}

export const REPORT_META: Record<ReportKind, ReportMeta> = {
  summary: {
    title: "Итоги встречи",
    icon: "✦",
    what: "Суть в 2–3 предложениях, главное, решения, задачи и открытые вопросы.",
    busy: "Подвожу итоги…",
  },
  tasks: {
    title: "Задачи",
    icon: "☑",
    what: "Таблица поручений: что сделать, кто отвечает, к какому сроку.",
    busy: "Ищу задачи…",
  },
  analysis: {
    title: "Разбор разговора",
    icon: "◎",
    what: "Позиции сторон, аргументы, тон, риски и рекомендации — для переговоров и продаж.",
    busy: "Разбираю…",
  },
  literary: {
    title: "Чистовой текст",
    icon: "¶",
    what: "Весь разговор связным текстом без повторов и слов-паразитов — для лекций и интервью.",
    busy: "Пишу текст…",
  },
  agent: {
    title: "Инструкция для ИИ",
    icon: "❯",
    what: "Готовый промпт для ИИ-агента: задача, контекст, требования, критерии — вставьте в Claude, Cursor, ChatGPT.",
    busy: "Пишу инструкцию…",
  },
  followup: {
    title: "Письмо по итогам",
    icon: "✉",
    what: "Готовое письмо участникам: договорённости и следующие шаги.",
    busy: "Пишу письмо…",
  },
  brief: {
    title: "Краткое резюме",
    icon: "•",
    what: "Прежний формат (заменён «Итогами встречи»).",
    busy: "…",
  },
};

/// Порядок показа и экспорта. `brief` — в конце (устаревший, только показ).
export const REPORT_ORDER: ReportKind[] = [
  "summary",
  "tasks",
  "analysis",
  "literary",
  "followup",
  "agent",
  "brief",
];

/// Отчёты, которые можно создать (кнопки-пресеты).
export const PRESETS: ReportKind[] = [
  "summary",
  "tasks",
  "agent",
  "analysis",
  "literary",
  "followup",
];

/// Событие «отчёты встречи обновились» (напр. авто-итоги после расшифровки).
export const REPORTS_EVENT = "memiro-reports-updated";
/// Событие «ИИ работает в фоне над встречей» — detail: { id, busy, label? }.
export const AI_AUTO_EVENT = "memiro-ai-auto";

export interface AiAutoDetail {
  id: string;
  busy: boolean;
  label?: string;
  error?: string;
}
