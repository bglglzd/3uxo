import React from "react";
import ReactDOM from "react-dom/client";
import { getVersion } from "@tauri-apps/api/app";
// Локальные шрифты (бандлятся в сборку, без CDN/утечек).
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/manrope";
import "@fontsource-variable/jetbrains-mono";
import App from "./App";
import "./App.css";
import { logError, logInfo, setAppInfo } from "./log";

// Глобальный перехват ошибок → в диагностический лог.
window.addEventListener("error", (e) =>
  logError("window.onerror", e.error ?? e.message),
);
window.addEventListener("unhandledrejection", (e) =>
  logError("unhandledrejection", (e as PromiseRejectionEvent).reason),
);

getVersion()
  .then((v) => setAppInfo(`3uxo ${v} · ${navigator.userAgent}`))
  .catch(() => setAppInfo(navigator.userAgent));
logInfo("app started");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
