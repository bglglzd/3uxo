import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AudioEditor } from "../components/AudioEditor";
import type { Meeting } from "../types";
import { api } from "../api";

/// Волна: 60 корзин, вторая треть громкая — чтобы было видно «где громкость».
const peaks = Array.from({ length: 60 }, (_, i) =>
  i >= 20 && i < 40 ? 800 : 40,
);

/// Бэкенд помнит, что оригинал уже сохранён, — как на самом деле после правки.
const backend = vi.hoisted(() => ({ hasOriginal: false }));

vi.mock("../api", () => ({
  api: {
    audioEditState: vi.fn(async () => ({
      tracks: ["mic.wav", "system.wav"],
      has_original: backend.hasOriginal,
    })),
    waveform: vi.fn(async () => ({
      peaks,
      rms: peaks.map((p) => p / 2),
      duration_secs: 60,
      sample_rate: 16000,
    })),
    trackUrl: vi.fn(async () => "asset://mic.wav"),
    applyAudioEdit: vi.fn(async () => {
      backend.hasOriginal = true;
      return { ...meeting, duration_secs: 50 };
    }),
    revertAudioEdit: vi.fn(async () => ({ ...meeting, duration_secs: 60 })),
    getBackendLog: vi.fn(async () => ""),
  },
}));

const meeting: Meeting = {
  id: "m1",
  created_at: "2026-08-18T10:00:00Z",
  title: "Созвон с Иваном",
  participants: "",
  topic: "",
  duration_secs: 60,
  folder: "m1",
  status: "recorded",
  source: "recorded",
};

function setup() {
  const onClose = vi.fn();
  const onApplied = vi.fn();
  const view = render(
    <AudioEditor meeting={meeting} onClose={onClose} onApplied={onApplied} />,
  );
  return { onClose, onApplied, ...view };
}

/// Протяжка по таймлайну: jsdom не считает геометрию, поэтому подменяем
/// getBoundingClientRect у сцены — 600 px на 60 секунд записи.
function stubStage(): HTMLElement {
  const stage = document.querySelector(".ae-stage") as HTMLElement;
  stage.getBoundingClientRect = () =>
    ({ left: 0, width: 600, top: 0, height: 200 }) as DOMRect;
  stage.setPointerCapture = () => {};
  stage.releasePointerCapture = () => {};
  return stage;
}

/// Выделяет фрагмент [fromSecs, toSecs) протяжкой мыши.
async function dragSelect(fromSecs: number, toSecs: number) {
  const stage = stubStage();
  const x = (s: number) => s * 10; // 600 px / 60 c
  await userEvent.pointer([
    { target: stage, keys: "[MouseLeft>]", coords: { clientX: x(fromSecs), clientY: 60 } },
    { target: stage, coords: { clientX: x(toSecs), clientY: 60 } },
    { target: stage, keys: "[/MouseLeft]", coords: { clientX: x(toSecs), clientY: 60 } },
  ]);
}

/// Итоговая длительность из футера («станет»): в линейке времени такие же
/// подписи, поэтому берём именно её элемент.
function willBe(): string {
  return document.querySelector(".ae-will")?.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.hasOriginal = false;
});

describe("AudioEditor", () => {
  it("показывает дорожки записи и длительность", async () => {
    setup();
    expect(await screen.findByText("Я")).toBeInTheDocument();
    expect(screen.getByText("Собеседник")).toBeInTheDocument();
    expect(screen.getByText("Правка аудио")).toBeInTheDocument();
    // Итог: пока правок нет, «станет» равно исходному.
    expect(screen.getByText("правок нет")).toBeInTheDocument();
    await waitFor(() =>
      expect(api.waveform).toHaveBeenCalledTimes(2),
    );
  });

  it("без выделения нельзя ни вырезать, ни применить", async () => {
    setup();
    await screen.findByText("Я");
    expect(screen.getByRole("button", { name: /Вырезать$/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Применить/ })).toBeDisabled();
    // Пока правок не было, кнопки возврата к оригиналу нет.
    expect(
      screen.queryByRole("button", { name: /Вернуть оригинал/ }),
    ).not.toBeInTheDocument();
  });

  it("протяжка выделяет фрагмент с точными границами", async () => {
    setup();
    await screen.findByText("Я");
    await dragSelect(10, 20);

    expect(screen.getByText("Выделено")).toBeInTheDocument();
    expect(screen.getByLabelText("Начало выделения")).toHaveValue("0:10.0");
    expect(screen.getByLabelText("Конец выделения")).toHaveValue("0:20.0");
    expect(screen.getByText("10.0 с")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Вырезать$/ })).toBeEnabled();
  });

  it("вырезает выделенное и пересчитывает итог", async () => {
    setup();
    await screen.findByText("Я");
    await dragSelect(10, 20);
    await userEvent.click(screen.getByRole("button", { name: /Вырезать$/ }));

    // 1:00 → 0:50, вырез отмечен на таймлайне и его можно снять.
    expect(screen.getByText("вырезов 1 · 10.0 с")).toBeInTheDocument();
    expect(willBe()).toBe("0:50");
    expect(
      screen.getByRole("button", { name: /Убрать вырез 0:10.0 – 0:20.0/ }),
    ).toBeInTheDocument();
    // Выделение снято — вырезать больше нечего.
    expect(screen.getByRole("button", { name: /Вырезать$/ })).toBeDisabled();
  });

  it("«оставить только это» вырезает всё вокруг выделения", async () => {
    setup();
    await screen.findByText("Я");
    await dragSelect(20, 30);
    await userEvent.click(
      screen.getByRole("button", { name: /Оставить только это/ }),
    );
    // Убраны [0,20) и [30,60) — остаётся 10 секунд.
    expect(screen.getByText("вырезов 2 · 50.0 с")).toBeInTheDocument();
    expect(willBe()).toBe("0:10");
  });

  it("шаг назад возвращает убранный фрагмент, шаг вперёд — снова убирает", async () => {
    setup();
    await screen.findByText("Я");
    await dragSelect(10, 20);
    await userEvent.click(screen.getByRole("button", { name: /Вырезать$/ }));
    expect(screen.getByText("вырезов 1 · 10.0 с")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Шаг назад" }));
    expect(screen.getByText("правок нет")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Шаг вперёд" }));
    expect(screen.getByText("вырезов 1 · 10.0 с")).toBeInTheDocument();
  });

  it("«убрать вырез» снимает конкретный вырез", async () => {
    setup();
    await screen.findByText("Я");
    await dragSelect(10, 20);
    await userEvent.click(screen.getByRole("button", { name: /Вырезать$/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /Убрать вырез 0:10.0 – 0:20.0/ }),
    );
    expect(screen.getByText("правок нет")).toBeInTheDocument();
  });

  it("применение спрашивает подтверждение и вызывает бэкенд", async () => {
    const { onApplied } = setup();
    await screen.findByText("Я");
    await dragSelect(10, 20);
    await userEvent.click(screen.getByRole("button", { name: /Вырезать$/ }));
    await userEvent.click(screen.getByRole("button", { name: /Применить/ }));

    // Диалог называет и объём правки, и то, что оригинал сохранится.
    expect(screen.getByText(/Останется 0:50/)).toBeInTheDocument();
    expect(screen.getByText(/Оригинал сохранится/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Вырезать и сохранить" }),
    );

    await waitFor(() =>
      expect(api.applyAudioEdit).toHaveBeenCalledWith("m1", [
        { start_secs: 10, end_secs: 20 },
      ]),
    );
    expect(onApplied).toHaveBeenCalled();
    // После применения список вырезов чист, появилась кнопка возврата.
    expect(await screen.findByText(/Готово: в записи 0:50/)).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelector(".ae-orig")).not.toBeNull(),
    );
    expect(screen.getByText("правок нет")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Вернуть оригинал/ }),
    ).toBeInTheDocument();
  });

  it("отмена подтверждения не трогает файлы", async () => {
    setup();
    await screen.findByText("Я");
    await dragSelect(10, 20);
    await userEvent.click(screen.getByRole("button", { name: /Вырезать$/ }));
    await userEvent.click(screen.getByRole("button", { name: /Применить/ }));
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(api.applyAudioEdit).not.toHaveBeenCalled();
    expect(screen.getByText("вырезов 1 · 10.0 с")).toBeInTheDocument();
  });

  it("возврат оригинала подтверждается и сбрасывает правки", async () => {
    backend.hasOriginal = true;
    const { onApplied } = setup();
    await screen.findByText("Я");
    await userEvent.click(
      screen.getByRole("button", { name: /Вернуть оригинал/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Вернуть исходное аудио" }),
    );
    await waitFor(() =>
      expect(api.revertAudioEdit).toHaveBeenCalledWith("m1"),
    );
    expect(onApplied).toHaveBeenCalled();
    expect(await screen.findByText(/Оригинал возвращён/)).toBeInTheDocument();
  });

  it("ошибка бэкенда показывается в баннере", async () => {
    vi.mocked(api.applyAudioEdit).mockRejectedValueOnce(new Error("диск полон"));
    setup();
    await screen.findByText("Я");
    await dragSelect(10, 20);
    await userEvent.click(screen.getByRole("button", { name: /Вырезать$/ }));
    await userEvent.click(screen.getByRole("button", { name: /Применить/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "Вырезать и сохранить" }),
    );
    expect(await screen.findByText(/диск полон/)).toBeInTheDocument();
  });

  it("щелчок без протяжки переносит плейхед, а не выделяет", async () => {
    setup();
    await screen.findByText("Я");
    await dragSelect(15, 15);
    expect(screen.queryByText("Выделено")).not.toBeInTheDocument();
    expect(screen.getByText("0:15.0")).toBeInTheDocument();
  });

  it("зум меняется и ограничен пределами", async () => {
    setup();
    await screen.findByText("Я");
    expect(screen.getByRole("button", { name: "Отдалить" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Приблизить" }));
    expect(screen.getByText("×2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отдалить" })).toBeEnabled();
  });

  it("«К встрече» выходит из редактора", async () => {
    const { onClose } = setup();
    await screen.findByText("Я");
    await userEvent.click(screen.getByRole("button", { name: /К встрече/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it("импортированная запись — одна дорожка «Запись»", async () => {
    vi.mocked(api.audioEditState).mockResolvedValueOnce({
      tracks: ["audio.wav"],
      has_original: false,
    });
    setup();
    expect(await screen.findByText("Запись")).toBeInTheDocument();
    expect(screen.queryByText("Собеседник")).not.toBeInTheDocument();
  });

  it("встреча без дорожек сообщает об этом", async () => {
    vi.mocked(api.audioEditState).mockResolvedValueOnce({
      tracks: [],
      has_original: false,
    });
    setup();
    expect(
      await screen.findByText("У этой встречи нет аудиодорожек."),
    ).toBeInTheDocument();
  });
});
