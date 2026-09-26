import React from "react";
import ReactDOM from "react-dom/client";
import { getVersion } from "@tauri-apps/api/app";
// Локальные шрифты (бандлятся в сборку, без CDN/утечек).
// Memiro: заголовки/лого — Manrope 800; интерфейс/текст — Golos Text.
import "@fontsource-variable/manrope";
import "@fontsource-variable/golos-text";
import "@fontsource-variable/jetbrains-mono";
import App from "./App";
import "./App.css";
import { logError, logInfo, setAppInfo } from "./log";
import { initTheme } from "./theme";
import { initPlatform } from "./platform";
import { initAppMenu } from "./appmenu";

// Применяем тему до рендера, чтобы не было вспышки светлого/тёмного.
initTheme();
// Платформа (macOS → вид по Apple HIG) и события строки меню macOS.
initPlatform();
void initAppMenu();

// Глобальный перехват ошибок → в диагностический лог.
window.addEventListener("error", (e) =>
  logError("window.onerror", e.error ?? e.message),
);
window.addEventListener("unhandledrejection", (e) =>
  logError("unhandledrejection", (e as PromiseRejectionEvent).reason),
);

getVersion()
  .then((v) => setAppInfo(`Memiro AI ${v} · ${navigator.userAgent}`))
  .catch(() => setAppInfo(`Memiro AI · ${navigator.userAgent}`));
logInfo("app started");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
