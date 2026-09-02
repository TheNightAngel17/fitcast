# CLAUDE.md — FitCast App Reference

Technical reference for the Electron app itself — architecture decisions, environment setup, and the file map. See the repo root [`CLAUDE.md`](../CLAUDE.md) for the project overview, repository layout, and CHANGELOG.md conventions. All paths and commands below are relative to this directory (`app/`).

## Key Decisions

### .fit Parser: `fit-file-parser` (v2.1.0)
- **Why**: Well-maintained, handles developer fields and unknown message types gracefully, converts FIT epoch timestamps to JS Date objects automatically. `easy-fit` was considered but is less maintained and has rougher error handling.
- **Gap handling**: Forward-fill short gaps (≤5s), leave longer gaps. Everything keyed off `elapsedSeconds` from ride start.
- **Verified**: FIT epoch conversion produces sane dates (test asserts year 2000-2030). Tested against the real fixture file in `example-data/`.

### ANT+ Library: `incyclist-ant-plus` (real hardware + simulated fallback)
- **Hardware path**: `AntBroadcaster` opens `AntDevice` from `incyclist-ant-plus/lib/bindings`, configures three TX channels (power 0x0B, HR 0x78, cadence 0x7A), and sends real ANT+ broadcast payloads at 4Hz via `antDevice.write()`.
- **Simulated fallback**: If `AntDevice.open()` fails (no dongle, wrong driver), broadcaster automatically falls back to logging payloads at the correct cadence. UI behaviour is identical.
- **Device IDs**: Passed from electron-store settings at broadcast start. Defaults: power=12345, HR=12346, cadence=12347.
- **Windows driver**: ANT USB-m Stick (VID=0x0fcf PID=0x1009) confirmed working with libusbK driver via Zadig. Use `node scripts/check-ant-device.mjs` to verify device is visible and openable.
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
- All IPC via `contextBridge.exposeInMainWorld` with explicit typed API (see `src/preload/index.ts`)
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
8. **Renderer components are untested** — `vitest.config.ts` uses `environment: 'node'` with no jsdom and no `@testing-library/*`. This is why the timeline's chart math lives in `src/shared/timeline.ts` rather than beside the components.

## Environment / Setup

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
| `src/shared/ride-data.ts` | Core data model: `RideData`, `RideSample`, `sampleAtElapsedSeconds()` |
| `src/shared/fit-parser.ts` | `.fit` file parsing → `RideData` normalization |
| `src/shared/timeline.ts` | Pure chart math: `decimateChannel()`, `channelExtent()`, `clampSelection()`, `niceCeiling()`, `zoneColorForValue()` |
| `src/shared/__tests__/` | Unit tests for data model, parser, and timeline math |
| `src/main/index.ts` | Electron main process, IPC handlers, window creation |
| `src/main/ant-broadcaster.ts` | ANT+ broadcast logic (simulated mode) with proper accumulators |
| `src/main/ffmpeg-check.ts` | Runtime ffmpeg detection |
| `src/main/settings.ts` | Persistent settings via electron-store |
| `src/preload/index.ts` | Secure `contextBridge` API surface |
| `src/renderer/src/App.tsx` | Root React component — owns `rideData`, the timeline `selection`, and the ANT+ status poll |
| `src/renderer/src/styles/timeline.css` | Timeline styling (imported by `RideTimeline.tsx`) |
| `src/renderer/src/components/FileDropZone.tsx` | Drag-and-drop .fit file input |
| `src/renderer/src/components/RideSummaryPanel.tsx` | Parsed ride data preview |
| `src/renderer/src/components/timeline/RideTimeline.tsx` | Timeline card: FTP input, range readout, composes both charts |
| `src/renderer/src/components/timeline/OverviewTrack.tsx` | Full-ride power minimap + the two-handle brush (all pointer/keyboard interaction) |
| `src/renderer/src/components/timeline/DetailChart.tsx` | Power (zone-filled, left axis) + heart rate (right axis) for the selected range |
| `src/renderer/src/components/timeline/paths.ts` | SVG path builders that break at recording gaps |
| `src/renderer/src/components/timeline/useElementWidth.ts` | `ResizeObserver` width hook |
| `src/renderer/src/components/RenderPanel.tsx` | Render configuration & trigger (range comes from the timeline) |
| `src/renderer/src/components/AntPanel.tsx` | ANT+ broadcast & playback controls (range comes from the timeline; status is a prop) |
| `src/renderer/src/components/StatusBar.tsx` | Status bar with colored messages |
| `electron.vite.config.ts` | electron-vite configuration |
| `example-data/` | Real .fit fixture file for testing |

## Suggested Next Steps (prioritized)

1. **Implement render pipeline**: Puppeteer headless frame capture → ffmpeg ProRes 4444 / VP9+alpha encoding. Wire progress reporting back to UI.
2. **Real ANT+ broadcasting**: Install `incyclist-ant-plus`, wire up real USB stick connection using the existing accumulator logic. Test against EBC.
3. **Overlay visual design**: Build the actual React overlay composition (power gauge, HR zone bar, cadence, etc.) that gets rendered frame-by-frame.
4. **OBS websocket integration**: `obs-websocket-js` for auto-start/stop recording sync.
5. **Settings persistence**: Wire UI controls for device IDs, output dir, codec defaults to electron-store (FTP is already wired).
6. **Error state polish**: Better UI error modals for dongle-not-found, driver-not-claimed, etc.
7. **Playback speed multiplier**: Nice-to-have for faster testing.
8. **Timeline extras**: scroll-to-zoom on the detail chart, extra channels (cadence/elevation), and snapping the brush to lap markers.
