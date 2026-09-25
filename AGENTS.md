# Auris

- Repository: https://github.com/bglglzd/auris (origin).
- Read `CLAUDE.md` for architecture and `docs/DEVELOPMENT.md` for local setup.
- Product name: Auris; identifier: `com.auris.app`; Rust core: `auris-core`.
- Legacy names belong only in compatibility migrations and their tests.
- Preserve user recordings, transcripts and preferences when changing storage.
- Use a topic branch and a pull request; do not push directly to `main`.
- Check frontend with `npm test` and `npm run build`.
- Check core with `cargo test -p auris-core --locked`; desktop with
  `cargo check -p auris --locked`. Optional native features require extra SDKs.
