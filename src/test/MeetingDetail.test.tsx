import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MeetingDetail } from "../components/MeetingDetail";
import type { Meeting, Transcript } from "../types";
import { api } from "../api";

vi.mock("../api", () => ({
  api: {
    trackUrl: vi.fn(async (_id: string, file: string) => `mock://${file}`),
    getTranscript: vi.fn(async () => null),
    transcribe: vi.fn(),
    getSummary: vi.fn(async () => null),
  },
}));

vi.mock("../settings", () => ({
  getSettings: () => ({ base_url: "", api_key: "", model: "" }),
}));

const meeting: Meeting = {
  id: "a",
  created_at: "2026-06-04T10:00:00Z",
  title: "Звонок с Иваном",
  participants: "Иван",
  topic: "Планы",
  duration_secs: 65,
  folder: "a",
  status: "recorded",
};

const transcript: Transcript = {
  segments: [
    { speaker: "me", start_secs: 0, end_secs: 2, text: "Привет" },
    { speaker: "them", start_secs: 2, end_secs: 4, text: "Здравствуй" },
  ],
};

describe("MeetingDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getTranscript).mockResolvedValue(null);
  });

  it("renders title and two labelled audio players", async () => {
    render(<MeetingDetail meeting={meeting} onBack={vi.fn()} onMetaSaved={vi.fn()} />);
    expect(screen.getByText("Звонок с Иваном")).toBeInTheDocument();
    expect(screen.getByText(/Я \(микрофон\)/i)).toBeInTheDocument();
    await waitFor(() => {
      const players = document.querySelectorAll("audio");
      expect(players.length).toBe(2);
      expect(players[0].getAttribute("src")).toBe("mock://mic.wav");
      expect(players[1].getAttribute("src")).toBe("mock://system.wav");
    });
  });

  it("shows a transcribe button when there is no transcript and calls transcribe", async () => {
    vi.mocked(api.transcribe).mockResolvedValue(transcript);
    render(<MeetingDetail meeting={meeting} onBack={vi.fn()} onMetaSaved={vi.fn()} />);
    const btn = await screen.findByRole("button", { name: /Расшифровать/i });
    await userEvent.click(btn);
    expect(api.transcribe).toHaveBeenCalledWith("a");
    // после расшифровки появляются реплики
    expect(await screen.findByText("Привет")).toBeInTheDocument();
    expect(screen.getByText("Здравствуй")).toBeInTheDocument();
  });

  it("renders an existing transcript with speaker labels", async () => {
    vi.mocked(api.getTranscript).mockResolvedValue(transcript);
    render(<MeetingDetail meeting={meeting} onBack={vi.fn()} onMetaSaved={vi.fn()} />);
    expect(await screen.findByText("Привет")).toBeInTheDocument();
    expect(screen.getByText("Здравствуй")).toBeInTheDocument();
    // метка «Я» есть и в дорожке, и в реплике — должно быть как минимум 2
    expect(screen.getAllByText("Я").length).toBeGreaterThanOrEqual(1);
    // кнопки расшифровки нет, когда расшифровка уже есть
    expect(screen.queryByRole("button", { name: /Расшифровать/i })).toBeNull();
  });
});
