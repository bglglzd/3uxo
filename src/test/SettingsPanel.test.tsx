import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsPanel } from "../components/SettingsPanel";
import { getSettings } from "../settings";

describe("SettingsPanel", () => {
  beforeEach(() => localStorage.clear());

  it("saves base URL and calls onClose when clicking Сохранить", async () => {
    const onClose = vi.fn();
    render(<SettingsPanel onClose={onClose} />);

    const inputs = screen.getAllByRole("textbox");
    // First textbox is Base URL
    await userEvent.clear(inputs[0]);
    await userEvent.type(inputs[0], "https://example.com/v1");

    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(getSettings().base_url).toBe("https://example.com/v1");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
