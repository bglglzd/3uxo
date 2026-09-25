# Auris — current status

> Release history lives in [CHANGELOG.md](../CHANGELOG.md). This page tracks what is
> verified, what still needs real-world testing and what is planned.

**Latest release:** see [GitHub Releases](https://github.com/bglglzd/auris/releases/latest).

## Verified automatically (CI)

- Frontend unit tests, type check and build; core tests (`uxo-core`).
- Full Windows build of the app with `whisper,diarize,opus,parakeet`.
- On Windows, with real models: speaker separation of the pyannote reference recording
  (2 voices, ~99% of speech time labelled correctly) and Parakeet transcription.

## Needs testing on real calls

- End-to-end on Windows: record → Parakeet transcription → voices on a real meeting,
  including group calls (3+ people on the system track).
- Auto-recording of calls (the call detector and monitor are built but not field-tested).
- The update dialog (first visible when a version newer than 0.8.x is published).

## Known limitations

- Windows only; macOS would need a new audio-capture layer.
- Parakeet covers 25 European languages; other languages fall back to Whisper.
- Speaker count tuning is based on reference recordings; the Voices panel lets users
  correct it (number of voices, merge) without re-transcribing.

## Ideas / roadmap

- Word-level timestamps to split a transcript line at a speaker change.
- Profanity filtering options and style variants for the clean-text preset.
- PDF export.
- macOS capture layer.
