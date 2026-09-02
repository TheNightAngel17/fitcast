# FitCast

Electron + React desktop app that parses cycling `.fit` files into a unified data model, then either renders a frame-accurate alpha-channel overlay video or replays the ride live over ANT+ to drive existing sensor-based overlay tools (like Xert EBC).

## Quick Start

```bash
# Prerequisites: Node.js 22+, npm
cd app
npm install
npm run dev
```

## Scripts

Run from `app/`.

| Command | Description |
|---------|-------------|
| `npm run dev` | Start in development mode with hot reload |
| `npm test` | Run unit tests |
| `npm run build` | Production build |
| `npm run package` | Build + package for distribution |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | TypeScript type checking |

## Download

Prebuilt Windows installers are attached to [GitHub Releases](https://github.com/TheNightAngel17/fitcast/releases). Builds are **unsigned** (code signing is out of scope), so Windows SmartScreen will warn when you run the installer — click "More info" > "Run anyway" to proceed.

## Usage

1. Launch the app
2. Drag-and-drop a `.fit` file (or click to browse)
3. Review the ride summary (power, HR, cadence, etc.)
4. Choose an action:
   - **Render**: Generate an overlay video with alpha channel (ProRes 4444 / VP9)
   - **Start Broadcasting**: Begin idle ANT+ broadcast for device pairing
   - **Playback**: Replay ride data over ANT+ in real-time

## Requirements

- **ffmpeg** on PATH (for render mode) — [download](https://ffmpeg.org/download.html)
- **ANT+ USB dongle** with WinUSB driver (for ANT+ mode) — see [CLAUDE.md](CLAUDE.md) for driver setup

## License

MIT
