<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="104" alt="Auris" />
</p>

<h1 align="center">Auris</h1>

<p align="center">
  <strong>Your third ear for meetings — private, local-first, for Windows and macOS.</strong><br />
  Record any call, transcribe it on your own computer, see who said what, and turn the conversation into notes, tasks and AI-ready briefs.
</p>

<p align="center">
  <a href="https://github.com/bglglzd/auris/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/bglglzd/auris?label=release&color=2e6fe0" /></a>
  <a href="https://github.com/bglglzd/auris/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/bglglzd/auris/actions/workflows/ci.yml/badge.svg" /></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%2010%2F11%20%C2%B7%20macOS%2013%2B-0fa8b8" />
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-7c5ce0" /></a>
</p>

<p align="center">
  <a href="https://github.com/bglglzd/auris/releases/latest"><b>Download</b></a> ·
  <a href="README.ru.md">Русский</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <img src="docs/screenshots/meeting-dark.png" width="860" alt="A meeting in Auris: player, voices panel and transcript" />
</p>

## Why Auris

Most meeting tools upload your conversations to someone else's cloud. Auris keeps them on your machine: recording, speech recognition and speaker separation all run locally. AI features are optional and use **your own** OpenAI-compatible endpoint and key.

- **Private by default** — audio, transcripts and reports never leave your computer.
- **Native on Windows and Mac** — Apple Silicon and Intel Macs included; on macOS Auris follows the platform's look and feel: translucent sidebar, SF font, menu bar, ⌘ shortcuts.
- **Works with any app** — Zoom, Teams, Telegram, Discord, Google Meet, a browser tab: if you can hear it, Auris can record it.
- **Accurate Russian and 25 European languages** — NVIDIA Parakeet v3 runs on a regular CPU; Whisper covers every other language.
- **Knows who is speaking** — automatic speaker detection, even in group calls.
- **From talk to action** — meeting summary, task table, conversation review, clean text, follow-up e-mail and a ready-made prompt for AI agents.

## Features

| | |
|---|---|
| ⏺ **Recording** | One button, tray / menu-bar icon or global hotkey (`Ctrl+Shift+R`, on Mac `⌘⇧R`). Two separate tracks — your microphone («Me») and system audio (the other side). Pause/resume, crash recovery, optional auto-recording when a call starts in a messenger (Windows). |
| 📝 **Transcription** | Fully offline. Default engine: **NVIDIA Parakeet TDT 0.6B v3** — punctuation and casing, ~10× faster than real time on a CPU, no hallucinations on silence. **Whisper** (large-v3-turbo and others; GPU via Vulkan on Windows, Metal on Apple Silicon) for any other language. Models download once. |
| 🗣 **Voices** | Speaker diarization (pyannote segmentation-3.0 + WeSpeaker ResNet34 on ONNX Runtime) with automatic speaker count. Voices panel: talk-time share, ▶ voice sample, names, merge two voices into one, change the number of voices instantly — no re-transcription. |
| ✦ **AI assistant** *(optional, your key)* | Auto title after transcription and six focused presets: **Meeting summary**, **Tasks** (who / what / when), **Conversation review**, **Clean text**, **Follow-up e-mail**, **AI agent brief** — a structured prompt for Claude, Cursor, ChatGPT and other agents. Ask any question about the meeting. Long meetings are handled chunk by chunk. |
| ⬇ **Export** | One dialog: **Word (.docx)**, Markdown, plain text or **SRT subtitles** — transcript (with or without timestamps) plus any AI reports in a single document. |
| ✂ **Audio editor** | Loudness timeline per track, cut unwanted parts, preview, apply to every track at once and keep the transcript in sync; one-click revert to the original. |
| 🔄 **Updates** | Signed updates. Auris checks for a new version, shows what's new, and installs and restarts only after you agree. |

<p align="center">
  <img src="docs/screenshots/ai-dark.png" width="420" alt="AI presets and reports" />
  <img src="docs/screenshots/models-light.png" width="420" alt="Local models: download once, work offline" />
</p>
<p align="center">
  <img src="docs/screenshots/export-dark.png" width="420" alt="Export to Word, Markdown, text or subtitles" />
  <img src="docs/screenshots/meeting-light.png" width="420" alt="Light theme" />
</p>

## Get started

1. Download Auris from the [latest release](https://github.com/bglglzd/auris/releases/latest):
   - **Windows** — `Auris_x.y.z_x64-setup.exe`, run the installer.
   - **Mac with Apple Silicon** (M1 and newer) — `Auris_x.y.z_aarch64.dmg`; **Intel Mac** — `Auris_x.y.z_x64.dmg`. Drag Auris to *Applications*. See [first launch on macOS](#first-launch-on-macos).
2. Press **Start recording** (or `Ctrl+Shift+R` / `⌘⇧R`) during a call, or **Import** an existing audio file (m4a, mp3, wav, ogg/opus, flac…).
3. Open the meeting and press **Transcribe**. On the first run Auris downloads the speech model (~0.5 GB) and the voice models (~33 MB) — once. You can also download them in advance in **Settings → Recognition**.
4. *(Optional)* In **Settings → Artificial intelligence** enter an OpenAI-compatible base URL, API key and model — OpenAI, OpenRouter, a local Ollama / LM Studio / llama.cpp server, anything compatible. Auris will then title the meeting and prepare a summary automatically.

> Please follow the call-recording consent laws that apply to you and to everyone on the call.

### First launch on macOS

Auris for Mac is not yet notarized by Apple, so the first time macOS will say it can't verify the developer:

1. Open *Applications*, **right-click Auris → Open**, then **Open** again. (Or: *System Settings → Privacy & Security* → **Open Anyway**.) This is needed only once.
2. **Microphone** — macOS asks on the first recording; allow it.
3. **Voices of the other side** — system audio is captured through ScreenCaptureKit, which needs *System Settings → Privacy & Security → Screen & System Audio Recording* → enable **Auris**, then restart the app. Settings → Recording in Auris shows the status and opens the right page. Only sound is recorded, never the screen, and Auris's own sounds are excluded. Without this permission Auris still records your microphone and tells you so.

Updates install in place like on Windows.

### System requirements

- **Windows** 10 or 11, x64.
- **macOS** 13 Ventura or newer, Apple Silicon or Intel.
- 8 GB RAM recommended; about 1.5 GB free disk space for models.
- A GPU is optional (Whisper can use Vulkan on Windows and Metal on Apple Silicon); Parakeet runs well on a CPU.

## Privacy

| Stays on your computer | Leaves your computer |
|---|---|
| Audio tracks, transcripts, speaker data, AI reports, settings and your API key | Only when you use AI: the transcript text of that meeting, sent to **the endpoint you configured** |
| Speech recognition and speaker separation — offline after the one-time model download | Model downloads (GitHub / Hugging Face) and the update check (GitHub Releases) |

There is no telemetry and no account. Data lives in the app's data folder (`%APPDATA%` on Windows, `~/Library/Application Support` on macOS); deleting a meeting deletes its files.

## How it works

```
microphone ─┐                          ┌─ Parakeet v3 / Whisper ─┐
            ├─ capture (2 tracks) ─────┤                         ├─ transcript ─┬─ Voices panel
system audio┘                          └─ pyannote + WeSpeaker ──┘              ├─ AI presets (your key)
                                                                                └─ Export (docx/md/txt/srt)
```

- **Recording** — two 16 kHz mono tracks. Windows: `wasapi_recorder` captures the microphone (event mode) and system audio via loopback (polling). macOS: `mac_recorder` captures the microphone through CoreAudio and system audio through ScreenCaptureKit (the app's own audio excluded).
- **Recognition** — tracks are normalized by the same decoder used for imports, split at pauses and transcribed by Parakeet (ONNX Runtime) or whisper.cpp.
- **Voices** — speech is segmented in 10-second windows; a voice embedding is computed for every local speaker; agglomerative clustering with small-cluster pruning finds the number of people. Embeddings are cached, so changing the number of voices is instant.
- **AI** — prompts are tuned per preset, include the names you gave to voices and never invent facts; long meetings use map-reduce.

## Build from source

Prerequisites: [Rust](https://rustup.rs) (stable), [Node.js](https://nodejs.org) 20+ and CMake, plus:

- **Windows** — LLVM (libclang) and, for the GPU build, the Vulkan SDK.
- **macOS 13+** — Xcode Command Line Tools. ONNX Runtime is loaded from a bundled dylib: fetch it once with `scripts/fetch-onnxruntime-macos.sh` (1.23.2, the last version built for both Intel and Apple Silicon).

```bash
npm ci
# Windows
npm run tauri dev -- --features whisper,diarize,opus,parakeet     # run
npm run tauri build -- --features gpu,diarize,opus,parakeet       # installer (release config)
# macOS (Apple Silicon: metal; Intel: whisper)
scripts/fetch-onnxruntime-macos.sh
npm run tauri dev -- --features metal,diarize,opus,parakeet
npm run tauri build -- --features metal,diarize,opus,parakeet     # .app + .dmg
```

On macOS always build through the Tauri CLI (`npm run tauri …`): it enables the private-API feature used for the translucent window.

| Cargo feature | What it adds |
|---|---|
| `parakeet` | NVIDIA Parakeet speech recognition (ONNX Runtime) |
| `whisper` / `gpu` / `metal` | Built-in whisper.cpp; `gpu` adds Vulkan (Windows), `metal` adds Metal (Apple Silicon) |
| `diarize` | Speaker separation (ONNX Runtime) |
| `opus` | Ogg/Opus import (voice messages) |

### Tests

The domain logic lives in the GUI-free `uxo-core` crate and is tested on any OS.

```bash
cargo test -p uxo-core                  # core: storage, audio, clustering, AI, exports…
npm test && npx tsc --noEmit            # frontend (vitest) and types
npm run build                           # frontend build
# end-to-end on real models (downloads them):
cargo test -p uxo-core --features diarize --test diarize_e2e -- --ignored
cargo test --release -p uxo-core --features parakeet --test parakeet_e2e -- --ignored
```

CI runs the frontend and core tests, a full Windows build of the app, macOS builds for Apple Silicon and Intel (with the diarization end-to-end test), and the end-to-end speech tests on Windows for every pull request.

### Project layout

```
core/        uxo-core — recording, storage, decoding, recognition, diarization, AI (no GUI)
src-tauri/   Tauri 2 desktop layer: commands, tray, hotkey, macOS menu bar, auto-record monitor
src/         React 19 + TypeScript UI (Auris design system in App.css)
docs/        release runbook, status, screenshots
```

## Releases

Every release is signed and published on [GitHub Releases](https://github.com/bglglzd/auris/releases) together with `latest.json` for in-app updates. See [CHANGELOG.md](CHANGELOG.md) for what changed and [docs/RELEASE.md](docs/RELEASE.md) for the release process.

## Contributing & security

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](.github/CODE_OF_CONDUCT.md). Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Auris contributors. Speech and voice models are downloaded from their authors and keep their own licenses (NVIDIA Parakeet — CC-BY-4.0, OpenAI Whisper — MIT, pyannote segmentation-3.0 — MIT, WeSpeaker ResNet34 — CC-BY-4.0).
