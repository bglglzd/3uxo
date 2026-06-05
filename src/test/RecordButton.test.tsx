import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { RecordButton } from "../components/RecordButton";

describe("RecordButton", () => {
  it("shows 'Начать запись' when idle and calls onStart on click", async () => {
    const onStart = vi.fn();
    render(<RecordButton recording={false} onStart={onStart} onStop={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /Начать запись/i });
    await userEvent.click(btn);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("shows 'Остановить' when recording and calls onStop on click", async () => {
    const onStop = vi.fn();
    render(<RecordButton recording={true} onStart={vi.fn()} onStop={onStop} />);
    const btn = screen.getByRole("button", { name: /Остановить/i });
    await userEvent.click(btn);
    expect(onStop).toHaveBeenCalledOnce();
  });
});
