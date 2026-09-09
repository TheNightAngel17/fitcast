# Offscreen capture spike — findings

Ran 2026-09-09T03:31:43.006Z, Electron 33.4.11, Chrome 130.0.6723.191, win32/x64.

Answers https://github.com/TheNightAngel17/fitcast/issues/40: can Electron's own offscreen Chromium
replace Puppeteer for the component render pipeline, with no second bundled browser?

## Overall: PASS — proceed with Electron's own Chromium

### straightAlpha: PASS

raw capture is PREMULTIPLIED (semi-white came back as {"b":128,"g":128,"r":128,"a":128}, not the ~(255,255,255,128) straight alpha would show) -- un-premultiplying recovers it exactly: {"r":255,"g":255,"b":255,"a":128}. A conversion step is required in the capture pipeline; it is not optional.

### scaleFactorReal: PASS

scale1 bitmap 200x200 (edge transition 1px), scale3 bitmap 603x600 (edge transition 1px), observed factor=3.02

### deterministicPacing: PASS

60 frames checked via the paint event, 0 mismatches

### throughput: PASS

33.31 ms/frame at 1920x1080 (300 frames timed)


## Raw results

```json
{
  "alpha": {
    "opaque": {
      "b": 0,
      "g": 0,
      "r": 255,
      "a": 255
    },
    "transparent": {
      "b": 0,
      "g": 0,
      "r": 0,
      "a": 0
    },
    "semiTransparentWhite": {
      "b": 128,
      "g": 128,
      "r": 128,
      "a": 128
    },
    "semiTransparentWhiteUnpremultiplied": {
      "r": 255,
      "g": 255,
      "b": 255,
      "a": 128
    },
    "bitmapSize": {
      "width": 400,
      "height": 300
    }
  },
  "scale1": {
    "requestedScale": 1,
    "logicalWidth": 200,
    "logicalHeight": 200,
    "bitmapWidth": 200,
    "bitmapHeight": 200,
    "edgeTransitionPx": 1
  },
  "scale3": {
    "requestedScale": 3,
    "logicalWidth": 200,
    "logicalHeight": 200,
    "bitmapWidth": 603,
    "bitmapHeight": 600,
    "edgeTransitionPx": 1
  },
  "pacing": {
    "framesChecked": 60,
    "mismatches": 0,
    "framesTimed": 300,
    "msPerFrame1080p": 33.30690033333334
  }
}
```

## Method

- **Alpha**: a 400x300 transparent offscreen `BrowserWindow` with three regions — fully opaque
  red, fully transparent (nothing painted), and a semi-transparent white square
  (`rgba(255,255,255,0.5)`). Captured via `capturePage()`'s raw BGRA bitmap and checked directly
  against the source values, catching premultiplication rather than assuming it away. It turned
  out to matter: the raw capture **is premultiplied** (RGB collapses toward the alpha value), so
  the check un-premultiplies before comparing, and separately confirms that recovery is exact.
- **Scale factor**: the same window renders a shape with a diagonal `clip-path` edge at a fixed
  logical size, once with `--force-device-scale-factor=1` and once with `=3` (each its own
  process, since the switch only applies before `app` is ready). Compares the resulting bitmap's
  actual pixel dimensions against the logical size (proving a real, separately-rendered surface
  exists at the higher resolution) and confirms the antialiased edge stays thin rather than
  widening in proportion to the scale factor (proving it's genuinely re-rasterized coverage-based
  antialiasing, not a naive stretch of the scale-1 bitmap — Chromium/Skia's AA is analytic, so a
  real higher-resolution render looks *crisper*, not blurrier, and does not get proportionally
  wider).
- **Determinism**: a marker element's background color is set to an exact, frame-index-derived
  RGB value, synchronized via a double-`requestAnimationFrame` promise the page returns to
  `executeJavaScript` (the standard "wait for an actual paint" signal), then captured via
  `capturePage()` and checked against the expected value — repeated for 60 frames. Any
  mismatch means a capture reflected the wrong frame. Two earlier synchronization strategies
  were tried and rejected because they produced exactly this kind of mismatch: reading the raw
  bitmap off the `paint` event's own callback argument went stale after ~20 frames and then
  froze solid; using `paint` only as a signal and re-capturing via `capturePage()` fixed the
  freeze but left an intermittent one-frame-behind race.
- **Throughput**: the same double-rAF-synchronized render loop, at 1920x1080, timed over 300
  frames after a short warmup, reported as ms/frame.
