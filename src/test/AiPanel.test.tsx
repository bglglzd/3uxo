import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiPanel } from "../components/AiPanel";
import type { Meeting } from "../types";
import { api } from "../api";

vi.mock("../settings", () => ({
  getSettings: () => ({ base_url: "u", api_key: "k", model: "m" }),
}));

vi.mock("../api", () => ({
  api: {
    getSummary: vi.fn(async () => null),
    summarize: vi.fn(async () => "выжимка"),
    suggestMetadata: vi.fn(async () => ({
      title: "T",
      participants: "P",
      topic: "Y",
    })),
    updateMeetingMeta: vi.fn(async () => undefined),
    ask: vi.fn(async () => "ответ"),
  },
}));

const meeting: Meeting = {
  id: "m1",
  created_at: "2026-06-04T10:00:00Z",
  title: "Тест митинга",
  participants: "Кто-то",
  topic: "Что-то",
  duration_secs: 120,
  folder: "m1",
  status: "recorded",
};

describe("AiPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSummary).mockResolvedValue(null);
    vi.mocked(api.summarize).mockResolvedValue("выжимка");
    vi.mocked(api.suggestMetadata).mockResolvedValue({
      title: "T",
      participants: "P",
      topic: "Y",
    });
    vi.mocked(api.updateMeetingMeta).mockResolvedValue(undefined);
    vi.mocked(api.ask).mockResolvedValue("ответ");
  });

  it("clicking Сделать выжимку calls api.summarize and renders the summary", async () => {
    render(<AiPanel meeting={meeting} onMetaSaved={vi.fn()} />);
    const btn = await screen.findByRole("button", { name: /Сделать выжимку/i });
    await userEvent.click(btn);
    expect(api.summarize).toHaveBeenCalledWith("m1", {
      base_url: "u",
      api_key: "k",
      model: "m",
    });
    expect(await screen.findByText("выжимка")).toBeInTheDocument();
  });

  it("clicking ИИ: предложить fills the Заголовок input with T", async () => {
    render(<AiPanel meeting={meeting} onMetaSaved={vi.fn()} />);
    const btn = await screen.findByRole("button", { name: /ИИ: предложить/i });
    await userEvent.click(btn);
    await waitFor(() => {
      const titleInput = screen.getByDisplayValue("T");
      expect(titleInput).toBeInTheDocument();
    });
  });

  it("clicking Сохранить calls api.updateMeetingMeta and triggers onMetaSaved", async () => {
    const onMetaSaved = vi.fn();
    render(<AiPanel meeting={meeting} onMetaSaved={onMetaSaved} />);
    // Wait for component to finish loading
    await screen.findByRole("button", { name: /Сохранить/i });
    const saveBtn = screen.getByRole("button", { name: /^Сохранить$/i });
    await userEvent.click(saveBtn);
    await waitFor(() => {
      expect(api.updateMeetingMeta).toHaveBeenCalledWith(
        "m1",
        meeting.title,
        meeting.participants,
        meeting.topic,
      );
      expect(onMetaSaved).toHaveBeenCalledOnce();
    });
  });

  it("typing a question and clicking Спросить renders the answer", async () => {
    render(<AiPanel meeting={meeting} onMetaSaved={vi.fn()} />);
    const questionInput = screen.getByPlaceholderText("Спросить…");
    await userEvent.type(questionInput, "Что обсуждали?");
    const askBtn = screen.getByRole("button", { name: /^Спросить$/i });
    await userEvent.click(askBtn);
    expect(api.ask).toHaveBeenCalledWith("m1", { base_url: "u", api_key: "k", model: "m" }, "Что обсуждали?");
    expect(await screen.findByText("ответ")).toBeInTheDocument();
  });
});
