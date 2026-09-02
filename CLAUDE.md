# CLAUDE.md — FitCast Project Reference

## Project Summary

FitCast is an Electron desktop app (React renderer + Node main process) that parses cycling `.fit` files into a normalized data model and provides two pipelines: (1) **Render mode** generates a pre-composited overlay video with alpha channel for Premiere compositing, and (2) **Playback mode** replays ride data in real-time over ANT+ radio, driving external overlay tools like Xert EBC. The UI has three primary actions: **Render** (video output), **Start Broadcasting** (idle ANT+ sensor discovery), and **Playback** (live ride data over ANT+).

Both pipelines operate on a **time range selected on the timeline**, not on the whole ride.

## Repository Layout

- `app/` — the Electron app itself: `package.json`, all source, config, and tooling. **Run every `npm` command from inside `app/`**, not the repo root.
- `docs/` — documentation, findings, and plans that aren't `CHANGELOG.md`, `CLAUDE.md`, or `README.md`.
- Repo root — only `CHANGELOG.md`, `CLAUDE.md`, `LICENSE`, `README.md`, `app/`, and `docs/`.

## CHANGELOG.md

### Format
Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): entries grouped under `### Added` / `### Changed` / `### Fixed` / `### Removed` / `### Deprecated` / `### Security`, newest version first, dates as `YYYY-MM-DD`. Omit empty category headers rather than leaving them blank. Version headers are `v`-prefixed (`## [v0.1.0]`) to match the git tag name exactly — the link footer below depends on this.

### Every change gets an Unreleased entry
Any change worth noting to someone using the app — a new feature, a behavior change, a bug fix — gets a bullet under `## [Unreleased]` in the same commit/PR that makes the change, not backfilled later. Skip purely internal changes (refactors, test-only changes, tooling) unless they change something a user or contributor would notice. Write entries in user-facing language describing what changed, not which file changed — match the tone of the existing v0.1.0 entries.

Before adding a new bullet, check whether Unreleased already has one for the same feature/area. If a feature was added, then fixed, then changed again, then fixed again — all before the next release — that's **one** entry, edited in place each time, not four. `[Unreleased]` should always read as the diff between the last released version and right now, never as a log of the individual commits that got you there. When a fix lands for something Unreleased already claims as `Added`/`Changed` this cycle, correct that existing bullet (and its wording) instead of appending a separate `Fixed` bullet — a `Fixed` entry belongs in Unreleased only when it fixes something that shipped in a *previous* release.

### Cutting a new version
1. Rename `## [Unreleased]` to `## [vX.Y.Z] - YYYY-MM-DD` and add a fresh, empty `## [Unreleased]` above it.
2. Update the link footer (see below).
3. `git tag -a vX.Y.Z -m "..."` on the release commit, then `git push origin vX.Y.Z`.

### Link footer
Each version header is a markdown link reference, resolved at the bottom of the file, using GitHub's `/compare/{base}...{head}` diff view:
- `[Unreleased]` always compares the newest tagged version against `HEAD`: `.../compare/vX.Y.Z...HEAD`.
- Every version *after* the first compares against the version immediately before it: `.../compare/vPREV...vX.Y.Z`.
- The very first version has nothing to diff against, so it links straight to the tag instead: `.../tree/vX.Y.Z`. Switch that to `.../releases/tag/vX.Y.Z` if a GitHub Release is ever published for it — a bare pushed tag doesn't get a releases page on its own.

Concretely, when v0.2.0 ships the footer becomes:
```
[Unreleased]: https://github.com/TheNightAngel17/fitcast/compare/v0.2.0...HEAD
[v0.2.0]: https://github.com/TheNightAngel17/fitcast/compare/v0.1.0...v0.2.0
[v0.1.0]: https://github.com/TheNightAngel17/fitcast/tree/v0.1.0
```

## Key Decisions

### .fit Parser: `fit-file-parser` (v2.1.0)
- **Why**: Well-maintained, handles developer fields and unknown message types gracefully, converts FIT epoch timestamps to JS Date objects automatically. `easy-fit` was considered but is less maintained and has rougher error handling.
- **Gap handling**: Forward-fill short gaps (≤5s), leave longer gaps. Everything keyed off `elapsedSeconds` from ride start.
- **Verified**: FIT epoch conversion produces sane dates (test asserts year 2000-2030). Tested against the real fixture file in `app/example-data/`.

### ANT+ Library: `incyclist-ant-plus` (real hardware + simulated fallback)
- **Hardware path**: `AntBroadcaster` opens `AntDevice` from `incyclist-ant-plus/lib/bindings`, configures three TX channels (power 0x0B, HR 0x78, cadence 0x7A), and sends real ANT+ broadcast payloads at 4Hz via `antDevice.write()`.
- **Simulated fallback**: If `AntDevice.open()` fails (no dongle, wrong driver), broadcaster automatically falls back to logging payloads at the correct cadence. UI behaviour is identical.
- **Device IDs**: Passed from electron-store settings at broadcast start. Defaults: power=12345, HR=12346, cadence=12347.
- **Windows driver**: ANT USB-m Stick (VID=0x0fcf PID=0x1009) confirmed working with libusbK driver via Zadig. From `app/`, use `node scripts/check-ant-device.mjs` to verify device is visible and openable.
- **Broadcast payload format**: `Messages.broadcastData([channelNo, ...8 data bytes])` — channel number is the first byte of the payload array.
- **CSP in dev**: `webRequest.onHeadersReceived` CSP override is skipped in dev mode (when `ELECTRON_RENDERER_URL` is set) so Vite HMR works.

### Render Pipeline: Stubbed
- **Current state**: The render button is wired but returns a "not implemented" stub. The intended approach is headless Chromium (via Puppeteer) frame capture + ffmpeg encoding, NOT Remotion.
- **Why not Remotion**: Remotion bundles its own Chromium which conflicts with Electron's, complicating distribution significantly. A Puppeteer-based pipeline is simpler for Electron packaging.
- **ffmpeg**: Detected at runtime via `spawn('ffmpeg', ['-version'])`. Clear error surfaced if missing. Not bundled — user must install.

### Timeline / Range Selection: hand-rolled SVG
- **Why not a chart library**: no charting dep is installed. Recharts' `Brush` can't do window-panning or Xert-style handles and needs heavy dark-theme restyling; uPlot is imperative DOM and awkward under React 18 StrictMode. Two hand-rolled SVGs cost ~450 lines and give full control.
- **Decimation, not raw plotting**: `decimateChannel()` buckets samples into one column per pixel keeping min/max/avg. The 4h fixture is 12,448 samples; the detail chart plots ~1,000 columns. The power envelope uses `max` so peaks survive (unit-tested against the fixture).
- **X is always `elapsedSeconds`, never sample index** — the parser leaves gaps >5s as real holes, so index-based plotting would compress pauses. `decimateChannel` emits `null` at those holes and the path breaks there.
- **Zone gradient**: colour depends only on the Y value, so a single vertical `<linearGradient>` with hard stops, clipped to the area path, reproduces the banding at zero per-column cost. It **must** be `gradientUnits="userSpaceOnUse"` — an objectBoundingBox gradient stretches to the path's own bounds and mis-colours any selection that doesn't reach the axis max.
- **FTP** is a persisted setting (default 250) driving the zones and the threshold line. Without it the chart falls back to a flat accent fill.

### Electron Architecture
- **electron-vite** for build tooling with Vite for both main and renderer
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- All IPC via `contextBridge.exposeInMainWorld` with explicit typed API (see `app/src/preload/index.ts`)
- CSP set via `webRequest.onHeadersReceived`
- File reads happen main-side; drag-and-drop passes path only

### Project Structure
- **electron-builder** for packaging, with `@electron/rebuild` for native module ABI compatibility

## Known Gaps / Unverified Assumptions

1. **ANT+ broadcasting entirely simulated** — no real USB hardware tested. Accumulator logic follows the ANT+ spec but is unverified against real receivers (EBC, Garmin, etc.)
2. **Render pipeline is a stub** — no actual video output yet. Needs Puppeteer + ffmpeg integration.
3. **OBS websocket integration** not started (stretch goal)
4. **Drift-corrected scheduler** implemented but untested over long durations (90+ min)
5. **electron-store** may need `electron-builder` `extraResources` config for production builds
6. **Windows-only**: Tested on Linux CI only. Windows-specific paths (Zadig driver, WinUSB) documented but not exercised.
7. **`npm run lint` does not work** — the script exists but there is no ESLint config file in the repo. `npm run typecheck` works for JSX now, but still reports one pre-existing error in `fit-parser.ts:78` (`Buffer<ArrayBufferLike>` vs the `Buffer<ArrayBuffer>` that `fit-file-parser`'s types demand).
8. **Renderer components are untested** — `vitest.config.ts` uses `environment: 'node'` with no jsdom and no `@testing-library/*`. This is why the timeline's chart math lives in `app/src/shared/timeline.ts` rather than beside the components.

## Environment / Setup

All commands below are run from inside `app/` (`cd app` first).

- **Node**: v22 LTS (pinned in `.nvmrc`)
- **Install**: `npm install` (runs `electron-builder install-app-deps` via postinstall for native module rebuild)
- **Dev**: `npm run dev` — starts electron-vite dev server with hot reload
- **Test**: `npm test` — runs vitest (shared module tests)
- **Build**: `npm run build` — production build
- **Package**: `npm run package` — builds + packages with electron-builder

### ANT+ Dongle Setup (Windows)
The ANT+ USB stick requires a libusb-compatible driver. **Use libusbK** — it works with both FitCast (via `incyclist-ant-plus`) AND Zwift simultaneously, so no driver swapping needed.

Install using [Zadig](https://zadig.akeo.ie/):
1. Plug in ANT+ dongle
2. Run Zadig → Options → List All Devices
3. Select the ANT+ device (ANT USB-m Stick, VID=0x0fcf PID=0x1009)
4. Select driver: **libusbK (v3.1.0.0)**
5. Click "Replace Driver"

**Driver notes:**
- `libusbK` allows both Zwift and FitCast to use the dongle — no switching required
- `WinUSB` also works with FitCast but breaks Zwift
- The original Garmin/ANT driver (libusb0) works with Zwift but not FitCast

### ffmpeg
Not bundled. Install from https://ffmpeg.org/download.html and ensure it's on PATH. The app detects availability at runtime and shows a clear error if missing.

## File Map

| Path | What |
|------|------|
| `app/src/shared/ride-data.ts` | Core data model: `RideData`, `RideSample`, `sampleAtElapsedSeconds()` |
| `app/src/shared/fit-parser.ts` | `.fit` file parsing → `RideData` normalization |
| `app/src/shared/timeline.ts` | Pure chart math: `decimateChannel()`, `channelExtent()`, `clampSelection()`, `niceCeiling()`, `zoneColorForValue()` |
| `app/src/shared/__tests__/` | Unit tests for data model, parser, and timeline math |
| `app/src/main/index.ts` | Electron main process, IPC handlers, window creation |
| `app/src/main/ant-broadcaster.ts` | ANT+ broadcast logic (simulated mode) with proper accumulators |
| `app/src/main/ffmpeg-check.ts` | Runtime ffmpeg detection |
| `app/src/main/settings.ts` | Persistent settings via electron-store |
| `app/src/preload/index.ts` | Secure `contextBridge` API surface |
| `app/src/renderer/src/App.tsx` | Root React component — owns `rideData`, the timeline `selection`, and the ANT+ status poll |
| `app/src/renderer/src/styles/timeline.css` | Timeline styling (imported by `RideTimeline.tsx`) |
| `app/src/renderer/src/components/FileDropZone.tsx` | Drag-and-drop .fit file input |
| `app/src/renderer/src/components/RideSummaryPanel.tsx` | Parsed ride data preview |
| `app/src/renderer/src/components/timeline/RideTimeline.tsx` | Timeline card: FTP input, range readout, composes both charts |
| `app/src/renderer/src/components/timeline/OverviewTrack.tsx` | Full-ride power minimap + the two-handle brush (all pointer/keyboard interaction) |
| `app/src/renderer/src/components/timeline/DetailChart.tsx` | Power (zone-filled, left axis) + heart rate (right axis) for the selected range |
| `app/src/renderer/src/components/timeline/paths.ts` | SVG path builders that break at recording gaps |
| `app/src/renderer/src/components/timeline/useElementWidth.ts` | `ResizeObserver` width hook |
| `app/src/renderer/src/components/RenderPanel.tsx` | Render configuration & trigger (range comes from the timeline) |
| `app/src/renderer/src/components/AntPanel.tsx` | ANT+ broadcast & playback controls (range comes from the timeline; status is a prop) |
| `app/src/renderer/src/components/StatusBar.tsx` | Status bar with colored messages |
| `app/electron.vite.config.ts` | electron-vite configuration |
| `app/example-data/` | Real .fit fixture file for testing |
| `docs/` | Documentation, findings, and plans outside the three root docs |

## Suggested Next Steps (prioritized)

1. **Implement render pipeline**: Puppeteer headless frame capture → ffmpeg ProRes 4444 / VP9+alpha encoding. Wire progress reporting back to UI.
2. **Real ANT+ broadcasting**: Install `incyclist-ant-plus`, wire up real USB stick connection using the existing accumulator logic. Test against EBC.
3. **Overlay visual design**: Build the actual React overlay composition (power gauge, HR zone bar, cadence, etc.) that gets rendered frame-by-frame.
4. **OBS websocket integration**: `obs-websocket-js` for auto-start/stop recording sync.
5. **Settings persistence**: Wire UI controls for device IDs, output dir, codec defaults to electron-store (FTP is already wired).
6. **Error state polish**: Better UI error modals for dongle-not-found, driver-not-claimed, etc.
7. **Playback speed multiplier**: Nice-to-have for faster testing.
8. **Timeline extras**: scroll-to-zoom on the detail chart, extra channels (cadence/elevation), and snapping the brush to lap markers.
