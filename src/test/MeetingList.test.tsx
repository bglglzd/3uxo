import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MeetingList } from "../components/MeetingList";
import type { Meeting } from "../types";

const meetings: Meeting[] = [
  {
    id: "a",
    created_at: "2026-06-04T10:00:00Z",
    title: "Звонок с Иваном",
    participants: "Иван",
    topic: "Планы",
    duration_secs: 65,
    folder: "a",
    status: "recorded",
  },
];

describe("MeetingList", () => {
  it("renders meeting titles and formatted duration", () => {
    render(<MeetingList meetings={meetings} onSelect={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("Звонок с Иваном")).toBeInTheDocument();
    expect(screen.getByText(/1:05/)).toBeInTheDocument();
  });

  it("shows empty state when no meetings", () => {
    render(<MeetingList meetings={[]} onSelect={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/Пока нет записей/i)).toBeInTheDocument();
  });

  it("calls onSelect with id when a meeting is clicked", async () => {
    const onSelect = vi.fn();
    render(<MeetingList meetings={meetings} onSelect={onSelect} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByText("Звонок с Иваном"));
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("calls onDelete with id when delete button is clicked and user confirms", async () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MeetingList meetings={meetings} onSelect={onSelect} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));
    expect(onDelete).toHaveBeenCalledWith("a");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not call onDelete when user cancels the confirm dialog", async () => {
    const onDelete = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MeetingList meetings={meetings} onSelect={vi.fn()} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));
    expect(onDelete).not.toHaveBeenCalled();
  });
});
