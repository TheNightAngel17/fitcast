# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Contributor Notes

#### Added

- `CONTRIBUTING.md`: the human-facing dev workflow, branching/PR process, and CI/CD guide, complementing `CLAUDE.md`'s AI-agent-facing conventions.
- Confirmed the render pipeline's frame capture will use Electron's own offscreen Chromium instead of Puppeteer, avoiding a second bundled browser. Verified empirically: alpha is recoverable (the raw capture is premultiplied and needs an explicit unpremultiply step), scaling re-rasterizes rather than stretching, frame-by-frame capture can be made deterministic, and throughput is ~33 ms/frame at 1920x1080. See `docs/findings/offscreen-capture-spike.md`.

## [v0.3.0] - 2026-09-08

### Release Notes

#### Changed

- **Render output formats** — the overlay now renders as ProRes 4444 (`.mov`) or a PNG sequence, both of which Premiere imports with transparency intact. Frame rate moved from a free-text box to a preset list carrying exact broadcast rates (23.976, 29.97, 59.94 and friends), defaulting to 29.97, and width/height are now validated before a render starts.

#### Removed

- **VP9 + alpha (`.webm`) output.** Premiere cannot import WebM natively, and the common third-party plugin writes alpha but cannot read it back, so the option could only ever produce a file that lost its transparency on import. Use ProRes 4444 instead.

### Contributor Notes

#### Added

- Release workflow: pushing a `vX.Y.Z` tag builds the Windows NSIS installer and publishes it to a GitHub Release, with release notes taken from the matching `CHANGELOG.md` version section. Installers are unsigned, so Windows SmartScreen will warn on first run.
- GitHub Actions CI workflow that runs lint, typecheck, test, and build for every pull request and every push to `main`, on a self-hosted Windows runner.

#### Fixed

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

[Unreleased]: https://github.com/TheNightAngel17/fitcast/compare/v0.3.0...HEAD
[v0.3.0]: https://github.com/TheNightAngel17/fitcast/compare/v0.2.0...v0.3.0
[v0.2.0]: https://github.com/TheNightAngel17/fitcast/compare/v0.1.0...v0.2.0
[v0.1.0]: https://github.com/TheNightAngel17/fitcast/tree/v0.1.0
