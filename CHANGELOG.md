# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- GitHub Actions CI workflow that runs lint, typecheck, test, and build on every pull request and every push to `main`.

### Fixed

- `npm run typecheck` no longer fails on a `fit-file-parser` `Buffer` type mismatch, so CI can gate on typecheck.

## [v0.2.0] - 2026-09-01

### Added

- Agent skill configuration for contributors using AI coding agents: issue tracker and domain-doc conventions documented under `docs/agents/`, referenced from `CLAUDE.md`.

### Changed

- Restructured the repository: all app source and tooling moved under `app/`, with a new `docs/` for non-root documentation. Only `CHANGELOG.md`, `CLAUDE.md`, `LICENSE`, `README.md`, `app/`, and `docs/` remain at the repo root. Run `npm` commands from inside `app/` going forward.

## [v0.1.0] - 2026-09-01

### Added

- **.fit file import** — parse cycling `.fit` files (drag-and-drop or file picker) into a normalized ride model, with power, heart rate, cadence, speed, altitude, distance, and temperature channels.
- **Ride summary** — at-a-glance stats after loading a ride: duration, moving time, avg/max/normalized power, avg/max heart rate, avg/max cadence, distance, and elevation gain.
- **Ride timeline** — an overview power minimap with a draggable two-handle range brush, and a detail chart of power (FTP-zone colored, with a threshold line) and heart rate for the selected range. Includes hover tooltips, a live playhead during ANT+ playback, and an Elapsed Time / Time of Day toggle.
- **FTP setting** (persisted) that drives the timeline's power-zone coloring and threshold line.
- **Render panel** — configure overlay video output (codec, resolution, fps) for the range selected on the timeline. The render pipeline itself is not implemented yet; triggering a render currently returns a "not implemented" status.
- **ANT+ broadcasting & playback** — broadcast idle sensor data for pairing (power, heart rate, cadence), then replay a ride's data in real time over ANT+, bounded to the range selected on the timeline. Uses real ANT+ USB hardware when available and falls back to simulated broadcasting otherwise.
- Persistent app settings (FTP, output directory, codec/resolution defaults, ANT+ device IDs) via electron-store.
- Dark-themed Electron app shell with drag-and-drop file loading and a status bar.

### Fixed

- ANT+ playback no longer runs past the end of a ride or selected range indefinitely — end-of-playback detection now compares elapsed time directly instead of a sample lookup that never returned `null` once played past the last sample.

[Unreleased]: https://github.com/TheNightAngel17/fitcast/compare/v0.2.0...HEAD
[v0.2.0]: https://github.com/TheNightAngel17/fitcast/compare/v0.1.0...v0.2.0
[v0.1.0]: https://github.com/TheNightAngel17/fitcast/tree/v0.1.0
