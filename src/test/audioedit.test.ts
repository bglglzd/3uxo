import { describe, it, expect } from "vitest";
import {
  normalizeCut,
  mergeCuts,
  cutsTotal,
  keptDuration,
  invertCuts,
  skipTarget,
  cutIndexAt,
  removeCutAt,
  downsample,
  clockPrecise,
  parseClock,
  toRanges,
  rulerStep,
  rulerTicks,
  wavePath,
} from "../audioedit";

describe("normalizeCut", () => {
  it("упорядочивает точки протяжки в любую сторону", () => {
    expect(normalizeCut(5, 2, 10)).toEqual({ start: 2, end: 5 });
    expect(normalizeCut(2, 5, 10)).toEqual({ start: 2, end: 5 });
  });
  it("зажимает вырез в границы записи", () => {
    expect(normalizeCut(-3, 99, 10)).toEqual({ start: 0, end: 10 });
  });
});

describe("mergeCuts", () => {
  it("сортирует, склеивает пересечения и убирает пустые", () => {
    expect(
      mergeCuts([
        { start: 5, end: 6 },
        { start: 1, end: 2 },
        { start: 1.5, end: 3 },
        { start: 3, end: 4 },
        { start: 8, end: 8 },
      ]),
    ).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 6 },
    ]);
  });
  it("не мутирует исходный массив", () => {
    const cuts = [{ start: 1, end: 2 }];
    mergeCuts([...cuts, { start: 1.5, end: 3 }]);
    expect(cuts[0]).toEqual({ start: 1, end: 2 });
  });
});

describe("cutsTotal / keptDuration", () => {
  it("считает вырезанное с учётом пересечений", () => {
    const cuts = [
      { start: 1, end: 3 },
      { start: 2, end: 4 },
    ];
    expect(cutsTotal(cuts)).toBe(3);
    expect(keptDuration(10, cuts)).toBe(7);
  });
  it("не уходит ниже нуля", () => {
    expect(keptDuration(2, [{ start: 0, end: 5 }])).toBe(0);
  });
});

describe("invertCuts", () => {
  it("оставляет только выделенное — вырезает начало и конец", () => {
    expect(invertCuts(10, { start: 3, end: 7 })).toEqual([
      { start: 0, end: 3 },
      { start: 7, end: 10 },
    ]);
  });
  it("не создаёт пустых вырезов, если выделено всё", () => {
    expect(invertCuts(10, { start: 0, end: 10 })).toEqual([]);
  });
  it("обрезка хвоста — один вырез", () => {
    expect(invertCuts(10, { start: 0, end: 4 })).toEqual([
      { start: 4, end: 10 },
    ]);
  });
});

describe("skipTarget", () => {
  const cuts = [
    { start: 2, end: 4 },
    { start: 6, end: 7 },
  ];
  it("перескакивает в конец выреза", () => {
    expect(skipTarget(3, cuts)).toBe(4);
    expect(skipTarget(6, cuts)).toBe(7);
  });
  it("не трогает звучащие места", () => {
    expect(skipTarget(1, cuts)).toBeNull();
    expect(skipTarget(4, cuts)).toBeNull();
    expect(skipTarget(9, cuts)).toBeNull();
  });
});

describe("cutIndexAt / removeCutAt", () => {
  const cuts = [
    { start: 1, end: 2 },
    { start: 5, end: 6 },
  ];
  it("находит вырез под точкой", () => {
    expect(cutIndexAt(cuts, 1.5)).toBe(0);
    expect(cutIndexAt(cuts, 5.5)).toBe(1);
    expect(cutIndexAt(cuts, 3)).toBe(-1);
  });
  it("снимает только один вырез", () => {
    expect(removeCutAt(cuts, 1.5)).toEqual([{ start: 5, end: 6 }]);
    expect(removeCutAt(cuts, 3)).toEqual(cuts);
  });
});

describe("downsample", () => {
  it("сохраняет пики при сжатии", () => {
    expect(downsample([0, 900, 0, 0, 10, 20], 2)).toEqual([900, 20]);
  });
  it("возвращает как есть, если сжимать не нужно", () => {
    expect(downsample([1, 2], 5)).toEqual([1, 2]);
  });
  it("пустые входные данные — пустой результат", () => {
    expect(downsample([], 10)).toEqual([]);
    expect(downsample([1, 2, 3], 0)).toEqual([]);
  });
  it("длина результата равна запрошенной", () => {
    expect(downsample(Array.from({ length: 1000 }, (_, i) => i), 37)).toHaveLength(37);
  });
});

describe("clockPrecise / parseClock", () => {
  it("показывает десятые доли секунды", () => {
    expect(clockPrecise(0)).toBe("0:00.0");
    expect(clockPrecise(83.42)).toBe("1:23.4");
    expect(clockPrecise(-5)).toBe("0:00.0");
  });
  it("разбирает мм:сс.д, секунды и запятую", () => {
    expect(parseClock("1:23.4")).toBeCloseTo(83.4);
    expect(parseClock("83.4")).toBeCloseTo(83.4);
    expect(parseClock("1:23")).toBe(83);
    expect(parseClock("2,5")).toBeCloseTo(2.5);
  });
  it("отбивает мусор", () => {
    expect(parseClock("")).toBeNull();
    expect(parseClock("abc")).toBeNull();
    expect(parseClock("1:2:3")).toBeNull();
    expect(parseClock("-4")).toBeNull();
  });
  it("туда-обратно", () => {
    expect(parseClock(clockPrecise(125.5))).toBeCloseTo(125.5);
  });
});

describe("toRanges", () => {
  it("переводит в поля бэкенда и канонизирует", () => {
    expect(
      toRanges([
        { start: 5, end: 6 },
        { start: 1, end: 2 },
        { start: 1.5, end: 2.5 },
      ]),
    ).toEqual([
      { start_secs: 1, end_secs: 2.5 },
      { start_secs: 5, end_secs: 6 },
    ]);
  });
});

describe("rulerStep / rulerTicks", () => {
  it("выбирает круглый шаг под длину записи", () => {
    expect(rulerStep(60, 1)).toBe(10);
    expect(rulerStep(3600, 1)).toBe(600);
    expect(rulerStep(20, 1)).toBe(5);
  });
  it("зум делает шаг мельче", () => {
    expect(rulerStep(3600, 8)).toBeLessThan(rulerStep(3600, 1));
  });
  it("шаг не мельче секунды даже при огромном зуме", () => {
    expect(rulerStep(10, 16)).toBe(1);
  });
  it("отметки идут от нуля и не липнут к правому краю", () => {
    expect(rulerTicks(60, 10)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(rulerTicks(0, 10)).toEqual([]);
    expect(rulerTicks(60, 0)).toEqual([]);
  });
});

describe("wavePath", () => {
  it("пустые данные — пустой путь", () => {
    expect(wavePath([])).toBe("");
  });
  it("тишина рисуется линией по центру", () => {
    const d = wavePath([0, 0]);
    expect(d).toBe("M 0 50.00 L 1 50.00 L 1 50.00 L 0 50.00 Z");
  });
  it("максимум занимает почти всю высоту и симметричен", () => {
    const d = wavePath([1000]);
    expect(d).toBe("M 0 4.00 L 0 96.00 Z");
  });
  it("замкнутый путь по числу столбцов", () => {
    const d = wavePath([100, 500, 900]);
    expect(d.match(/L/g)).toHaveLength(5); // 3 сверху + 3 снизу − стартовый M
    expect(d.endsWith("Z")).toBe(true);
  });
});
