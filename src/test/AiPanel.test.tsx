import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiPanel } from "../components/AiPanel";
import type { Meeting } from "../types";
import { api } from "../api";

vi.mock("../settings", () => ({
  getSettings: () => ({
    ai: { base_url: "u", api_key: "k", model: "m" },
    whisper: { whisperPath: "", model: "", language: "" },
  }),
  isAiConfigured: () => true,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(async () => null),
}));

vi.mock("../api", () => ({
  api: {
    getSummary: vi.fn(async () => null),
    summarize: vi.fn(async () => "выжимка"),
    getLiterary: vi.fn(async () => null),
    literaryText: vi.fn(async () => "литературный текст"),
    suggestMetadata: vi.fn(async () => ({ title: "T", participants: "P", topic: "Y" })),
    updateMeetingMeta: vi.fn(async () => {}),
    saveTextFile: vi.fn(async () => {}),
    ask: vi.fn(async () => "ответ"),
  },
}));

const meeting: Meeting = {
  id: "a",
  created_at: "2026-06-04T10:00:00Z",
  title: "t",
  participants: "",
  topic: "",
  duration_secs: 1,
  folder: "a",
  status: "transcribed",
};

describe("AiPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSummary).mockResolvedValue(null);
  });

  it("creates a summary", async () => {
    vi.mocked(api.summarize).mockResolvedValue("выжимка");
    render(<AiPanel meeting={meeting} onMetaSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Выжимка" }));
    expect(await screen.findByText("выжимка")).toBeInTheDocument();
  });

  it("creates a literary text", async () => {
    vi.mocked(api.literaryText).mockResolvedValue("литературный текст");
    render(<AiPanel meeting={meeting} onMetaSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Литературный текст/i }));
    expect(await screen.findByText("литературный текст")).toBeInTheDocument();
  });

  it("suggests metadata and saves it", async () => {
    const onMetaSaved = vi.fn();
    render(<AiPanel meeting={meeting} onMetaSaved={onMetaSaved} />);
    await userEvent.click(screen.getByRole("button", { name: /Авто-заголовок/i }));
    expect(api.suggestMetadata).toHaveBeenCalledWith("a", expect.anything());
    expect(api.updateMeetingMeta).toHaveBeenCalledWith("a", "T", "P", "Y");
  });

  it("answers a question", async () => {
    vi.mocked(api.ask).mockResolvedValue("ответ");
    render(<AiPanel meeting={meeting} onMetaSaved={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText(/Спросить/i), "вопрос?");
    await userEvent.click(screen.getByRole("button", { name: /^Спросить$/i }));
    expect(await screen.findByText("ответ")).toBeInTheDocument();
  });
});
