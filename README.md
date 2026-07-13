<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="96" alt="Auris icon" />
</p>

<h1 align="center">Auris</h1>

<p align="center">
  <strong>Your private, local-first meeting memory for Windows.</strong><br />
  Record calls, transcribe them on your machine, and turn conversations into useful notes with AI you control.
</p>

<p align="center">
  <a href="https://github.com/bglglzd/3uxo/releases/latest">Download the latest release</a>
  ·
  <a href="README.ru.md">Русский</a>
  ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

## Why Auris

Most meeting tools treat your conversations as someone else's cloud data. Auris is built for a different workflow: recordings and transcripts stay on your Windows PC, local Whisper handles transcription, and AI is an optional layer that uses the provider, endpoint, and key you choose.

- **Private by default** — audio and transcripts remain local.
- **Two-track recording** — your microphone and system audio are captured separately, so conversations stay easier to follow.
- **Local transcription** — Whisper runs on-device rather than sending raw audio to a hosted transcription service.
- **Bring your own AI** — connect any OpenAI-compatible endpoint for summaries, meeting metadata, questions, and analysis.

## What it does

- Record calls from Windows apps with one button, a tray action, or the global `Ctrl+Shift+R` shortcut.
- Pause and resume recordings without losing the final meeting file.
- Import existing audio recordings for transcription.
- Keep a local library of meetings, speakers, transcripts, and AI reports.
- Edit transcript entries and generated reports after processing.
- Export transcripts and reports as plain text or Markdown.

## How it works

1. Auris records your microphone and Windows system audio as separate tracks.
2. It transcribes the tracks locally with Whisper and merges them into a single conversation timeline.
3. When you opt in, an OpenAI-compatible model can create a title, short brief, summary, analysis, literary version, or answer questions about the meeting.

Your AI credentials are stored locally. Only the prompt content you choose to send leaves your device, and only goes to the endpoint you configure.

## Download and use

1. Download the Windows installer from the [latest release](https://github.com/bglglzd/3uxo/releases/latest).
2. Record a call or import an existing audio file.
3. Let Auris create a local transcript.
4. Optionally open **AI settings** and provide an OpenAI-compatible base URL, API key, and model.

Please follow the recording-consent laws that apply to you and everyone in a call.

## Built with

Tauri 2 · Rust · React · TypeScript · SQLite · Whisper (`whisper-rs`) · WASAPI

Auris is Windows-first. The technical repository name remains `3uxo` to preserve existing updater and local-data compatibility; the visible product name is Auris.

## Development

Prerequisites: Windows, Rust, Node.js, CMake, and LLVM/libclang for local Whisper builds.

```bash
npm install
npm test
npm run build
npm run tauri dev -- --features gpu,diarize,opus
```

The domain logic lives in the cross-platform `uxo-core` crate; the Windows desktop layer lives in `src-tauri`.

```bash
cargo test -p uxo-core
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and [docs/RELEASE.md](docs/RELEASE.md) for release steps.

## License

[MIT](LICENSE)
