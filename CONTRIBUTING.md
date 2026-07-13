# Contributing to Auris

Thanks for helping improve Auris. The product name is **Auris**; the repository
and updater identifiers intentionally remain `3uxo` for compatibility with
existing installations.

## Before opening an issue

- Search existing issues and pull requests first.
- For a bug, include the Auris version, Windows version, exact reproduction
  steps, expected result, and observed result.
- Never include API keys, raw private transcripts, or private audio in a public
  issue. Redact logs before sharing them.

## Development setup

The supported product platform is Windows. Core and frontend checks can run
independently:

```bash
npm ci
npm test
npx tsc --noEmit
npm run build
cargo test -p uxo-core
```

The Tauri app and audio capture paths may additionally require Windows tooling;
see the README for details.

## Pull requests

1. Start from the current `main` branch and keep the change focused.
2. Explain the user-visible problem and link the relevant issue or discussion.
3. Add or update tests whenever behaviour changes.
4. Run the checks relevant to the files you changed and include the results in
   the PR description.
5. Do not mix refactors, formatting-only changes, or unrelated features into a
   bug fix.

By contributing, you agree that your contribution can be distributed under the
repository's MIT license.
