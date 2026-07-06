import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RecordingMonitor } from "../components/RecordingMonitor";
import type { TrackLevels } from "../types";

function feed(levels: TrackLevels, times: number) {
  const { rerender } = render(
    <RecordingMonitor levels={levels} solo={false} />,
  );
  // Новый объект-литерал на каждый кадр — меняет идентичность prop, как делает App.
  for (let i = 0; i < times; i++) {
    rerender(
      <RecordingMonitor
        levels={{ mic: levels.mic, system: levels.system }}
        solo={false}
      />,
    );
  }
}

describe("RecordingMonitor", () => {
  it("рисует два тайла: Вы и Собеседник", () => {
    render(
      <RecordingMonitor levels={{ mic: 0, system: 0 }} solo={false} />,
    );
    expect(screen.getByText(/Вы/)).toBeInTheDocument();
    expect(screen.getByText(/Собеседник/)).toBeInTheDocument();
  });

  it("в solo показывает только тайл «Вы»", () => {
    render(
      <RecordingMonitor levels={{ mic: 0, system: 0 }} solo={true} />,
    );
    expect(screen.getByText(/Вы/)).toBeInTheDocument();
    expect(screen.queryByText(/Собеседник/)).not.toBeInTheDocument();
  });

  it("не показывает «тишина» в самом начале записи", () => {
    render(
      <RecordingMonitor levels={{ mic: 500, system: 500 }} solo={false} />,
    );
    expect(screen.queryByText(/тишина/i)).not.toBeInTheDocument();
  });

  it("показывает предупреждение о тишине на молчащей дорожке", () => {
    // мик звучит, собеседник молчит ~3.3с (55 опросов × 60мс)
    feed({ mic: 500, system: 0 }, 55);
    const warnings = screen.getAllByText(/тишина/i);
    expect(warnings.length).toBe(1);
  });
});
