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
  it("renders title and formatted duration", () => {
    render(<MeetingList meetings={meetings} onSelect={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("Звонок с Иваном")).toBeInTheDocument();
    expect(screen.getByText(/1:05/)).toBeInTheDocument();
  });

  it("shows empty state", () => {
    render(<MeetingList meetings={[]} onSelect={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/Пока нет записей/i)).toBeInTheDocument();
  });

  it("calls onSelect when a meeting is clicked", async () => {
    const onSelect = vi.fn();
    render(<MeetingList meetings={meetings} onSelect={onSelect} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByText("Звонок с Иваном"));
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("deletes after confirming in the dialog, without selecting", async () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(<MeetingList meetings={meetings} onSelect={onSelect} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: "Действия со встречей" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Удалить встречу/ }));
    // подтверждаем во всплывшем диалоге
    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));
    expect(onDelete).toHaveBeenCalledWith("a");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not delete when the dialog is cancelled", async () => {
    const onDelete = vi.fn();
    render(<MeetingList meetings={meetings} onSelect={vi.fn()} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: "Действия со встречей" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Удалить встречу/ }));
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("renames and adds notes from the ⋯ menu", async () => {
    const onEdit = vi.fn();
    const onSelect = vi.fn();
    render(
      <MeetingList meetings={meetings} onSelect={onSelect} onDelete={vi.fn()} onEdit={onEdit} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Действия со встречей" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Переименовать/ }));
    const title = screen.getByLabelText("Название");
    await userEvent.clear(title);
    await userEvent.type(title, "Бюджет Q3");
    await userEvent.type(screen.getByLabelText("Заметки"), "перезвонить в пятницу");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(onEdit).toHaveBeenCalledWith("a", {
      title: "Бюджет Q3",
      participants: "Иван",
      topic: "Планы",
      notes: "перезвонить в пятницу",
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows the first line of notes in the list", () => {
    render(
      <MeetingList
        meetings={[{ ...meetings[0], notes: "\nважно: смета\nвторая строка" }]}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("важно: смета")).toBeInTheDocument();
  });
});
