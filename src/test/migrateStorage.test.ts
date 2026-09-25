import { beforeEach, expect, it } from "vitest";
import { migrateStorage } from "../migrateStorage";

beforeEach(() => localStorage.clear());

it("preserves settings and per-meeting preferences without overwriting Auris values", () => {
  localStorage.setItem("3uxo.settings", '{"ai":{"api_key":"example"}}');
  localStorage.setItem("3uxo.solo.meeting-1", "1");
  localStorage.setItem("3uxo.theme", "light");
  localStorage.setItem("auris.theme", "dark");
  localStorage.setItem("other.key", "unrelated");
  migrateStorage(localStorage);
  migrateStorage(localStorage);
  expect(localStorage.getItem("auris.settings")).toBe(localStorage.getItem("3uxo.settings"));
  expect(localStorage.getItem("auris.solo.meeting-1")).toBe("1");
  expect(localStorage.getItem("auris.theme")).toBe("dark");
  expect(localStorage.getItem("other.key")).toBe("unrelated");
  expect(localStorage.getItem("auris.key")).toBeNull();
});
