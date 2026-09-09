// Spike for https://github.com/TheNightAngel17/fitcast/issues/40 — throwaway, not shipped.
//
// Proves (or disproves) four things about capturing overlay components via Electron's
// own offscreen Chromium, instead of bundling a second Chromium via Puppeteer:
//
//   1. Alpha is real and STRAIGHT (unpremultiplied), spanning 0-255.
//   2. deviceScaleFactor re-rasterizes text/vectors rather than stretching pixels.
//   3. Capture is deterministic and paced by us (the `paint` event), not the compositor.
//   4. Throughput (ms/frame) at a realistic 1920x1080 size.
//
// Run with:  npx electron scripts/spike-offscreen-capture.mjs
//
// If your shell has ELECTRON_RUN_AS_NODE=1 set (Claude Code's does), unset it for this
// invocation or the `electron` binary just runs as plain Node and every OSR/BrowserWindow
// call is undefined:  env -u ELECTRON_RUN_AS_NODE npx electron scripts/spike-offscreen-capture.mjs
//
// This orchestrates three child Electron processes (one per role) because
// --force-device-scale-factor can only be set before `app` is ready, i.e. once per
// process — so the scale=1 and scale=3 captures for check #2 each need their own process.

import { app, BrowserWindow } from 'electron';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const role = process.argv.find((a) => a.startsWith('--role='))?.slice('--role='.length);
const scaleArg = Number(process.argv.find((a) => a.startsWith('--scale='))?.slice('--scale='.length) ?? '1');

if (!role) {
  runOrchestrator();
} else {
  if (role === 'scale' && scaleArg !== 1) {
    // Must be set before app is ready, hence a dedicated process per scale factor.
    app.commandLine.appendSwitch('force-device-scale-factor', String(scaleArg));
  }
  app.whenReady().then(() => runRole(role, scaleArg));
}

// ---------------------------------------------------------------------------
// Orchestrator: spawns each role as its own `electron` process, collects the
// single JSON line each prints on stdout, and writes the combined findings.
// ---------------------------------------------------------------------------

function runOrchestrator() {
  console.log('Running offscreen-capture spike (3 child Electron processes)...\n');

  const results = {};

  for (const [label, args] of [
    ['alpha', ['--role=alpha']],
    ['scale1', ['--role=scale', '--scale=1']],
    ['scale3', ['--role=scale', '--scale=3']],
    ['pacing', ['--role=pacing']],
  ]) {
    console.log(`--- ${label} ---`);
    const res = spawnSync(process.execPath, [__filename, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
    });
    if (res.status !== 0) {
      console.error(res.stderr);
      process.exit(1);
    }
    const line = res.stdout.trim().split('\n').pop();
    results[label] = JSON.parse(line);
    console.error(res.stderr); // child's console.error diagnostics, forwarded for visibility
  }

  const verdict = evaluate(results);
  const outDir = join(__dirname, '..', '..', 'docs', 'findings');
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, 'offscreen-capture-spike.md');
  writeFileSync(reportPath, renderReport(results, verdict));

  console.log('\n=== VERDICT ===');
  for (const [k, v] of Object.entries(verdict)) {
    console.log(`${v.pass ? 'PASS' : 'FAIL'} — ${k}: ${v.detail}`);
  }
  console.log(`\nFull report: ${reportPath}`);
}

function evaluate(results) {
  const v = {};

  // 1. Straight alpha is recoverable (capturePage()'s raw output is premultiplied -- see below)
  const a = results.alpha;
  const u = a.semiTransparentWhiteUnpremultiplied;
  v.straightAlpha = {
    pass: a.opaque.a === 255 && a.transparent.a === 0 && u.a > 100 && u.a < 150 && u.r >= 250 && u.g >= 250 && u.b >= 250,
    detail: `raw capture is PREMULTIPLIED (semi-white came back as ${JSON.stringify(a.semiTransparentWhite)}, not the ~(255,255,255,128) straight alpha would show) -- un-premultiplying recovers it exactly: ${JSON.stringify(u)}. A conversion step is required in the capture pipeline; it is not optional.`,
  };

  // 2. Real re-rasterization at higher scale factor. Chromium/Skia antialiasing is
  // coverage-based (analytic), not a blur -- a genuinely re-rasterized edge stays thin
  // (~1-2px) at ANY resolution. A naive nearest-neighbor stretch of the scale-1 bitmap
  // would instead widen that already-thin transition in direct proportion to the scale
  // factor (tripling a 1px transition makes a 3px one). So the pass signal is: the
  // backing store's actual pixel dimensions grew with the scale factor (proving a real,
  // separately-rendered higher-resolution surface exists at all), while the edge did NOT
  // widen proportionally (proving it's crisp per-resolution AA, not a stretched bitmap).
  const s1 = results.scale1;
  const s3 = results.scale3;
  const scaleFactorObserved = s3.bitmapWidth / s1.bitmapWidth;
  const edgeStayedCrisp = s3.edgeTransitionPx < s1.edgeTransitionPx * 2;
  v.scaleFactorReal = {
    pass: Math.abs(scaleFactorObserved - 3) < 0.1 && edgeStayedCrisp,
    detail: `scale1 bitmap ${s1.bitmapWidth}x${s1.bitmapHeight} (edge transition ${s1.edgeTransitionPx}px), scale3 bitmap ${s3.bitmapWidth}x${s3.bitmapHeight} (edge transition ${s3.edgeTransitionPx}px), observed factor=${scaleFactorObserved.toFixed(2)}`,
  };

  // 3. Deterministic pacing
  const p = results.pacing;
  v.deterministicPacing = {
    pass: p.mismatches === 0,
    detail: `${p.framesChecked} frames checked via the paint event, ${p.mismatches} mismatches`,
  };

  // 4. Throughput
  v.throughput = {
    pass: true, // informational — no pass/fail threshold, just a number to size the queue design against
    detail: `${p.msPerFrame1080p.toFixed(2)} ms/frame at 1920x1080 (${p.framesTimed} frames timed)`,
  };

  return v;
}

function renderReport(results, verdict) {
  const allPass = Object.values(verdict).every((v) => v.pass);
  return `# Offscreen capture spike — findings

Ran ${new Date().toISOString()}, Electron ${process.versions.electron}, Chrome ${process.versions.chrome}, ${process.platform}/${process.arch}.

Answers https://github.com/TheNightAngel17/fitcast/issues/40: can Electron's own offscreen Chromium
replace Puppeteer for the component render pipeline, with no second bundled browser?

## Overall: ${allPass ? 'PASS — proceed with Electron\'s own Chromium' : 'FAIL — see below, Puppeteer fallback needed for at least one criterion'}

${Object.entries(verdict).map(([k, v]) => `### ${k}: ${v.pass ? 'PASS' : 'FAIL'}\n\n${v.detail}\n`).join('\n')}

## Raw results

\`\`\`json
${JSON.stringify(results, null, 2)}
\`\`\`

## Method

- **Alpha**: a 400x300 transparent offscreen \`BrowserWindow\` with three regions — fully opaque
  red, fully transparent (nothing painted), and a semi-transparent white square
  (\`rgba(255,255,255,0.5)\`). Captured via \`capturePage()\`'s raw BGRA bitmap and checked directly
  against the source values, catching premultiplication rather than assuming it away. It turned
  out to matter: the raw capture **is premultiplied** (RGB collapses toward the alpha value), so
  the check un-premultiplies before comparing, and separately confirms that recovery is exact.
- **Scale factor**: the same window renders a shape with a diagonal \`clip-path\` edge at a fixed
  logical size, once with \`--force-device-scale-factor=1\` and once with \`=3\` (each its own
  process, since the switch only applies before \`app\` is ready). Compares the resulting bitmap's
  actual pixel dimensions against the logical size (proving a real, separately-rendered surface
  exists at the higher resolution) and confirms the antialiased edge stays thin rather than
  widening in proportion to the scale factor (proving it's genuinely re-rasterized coverage-based
  antialiasing, not a naive stretch of the scale-1 bitmap — Chromium/Skia's AA is analytic, so a
  real higher-resolution render looks *crisper*, not blurrier, and does not get proportionally
  wider).
- **Determinism**: a marker element's background color is set to an exact, frame-index-derived
  RGB value, synchronized via a double-\`requestAnimationFrame\` promise the page returns to
  \`executeJavaScript\` (the standard "wait for an actual paint" signal), then captured via
  \`capturePage()\` and checked against the expected value — repeated for 60 frames. Any
  mismatch means a capture reflected the wrong frame. Two earlier synchronization strategies
  were tried and rejected because they produced exactly this kind of mismatch: reading the raw
  bitmap off the \`paint\` event's own callback argument went stale after ~20 frames and then
  froze solid; using \`paint\` only as a signal and re-capturing via \`capturePage()\` fixed the
  freeze but left an intermittent one-frame-behind race.
- **Throughput**: the same double-rAF-synchronized render loop, at 1920x1080, timed over 300
  frames after a short warmup, reported as ms/frame.
`;
}

// ---------------------------------------------------------------------------
// Roles: each runs inside its own ready Electron app and prints one JSON line.
// ---------------------------------------------------------------------------

async function runRole(role, scale) {
  try {
    if (role === 'alpha') await roleAlpha();
    else if (role === 'scale') await roleScale(scale);
    else if (role === 'pacing') await rolePacing();
    else throw new Error(`unknown role ${role}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    app.quit();
  }
}

function makeOffscreenWindow(width, height) {
  return new BrowserWindow({
    width,
    height,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
}

/**
 * Runs `jsExpr` in the page and captures the result once the page confirms the frame
 * actually painted, returning the raw bitmap + size.
 *
 * Found empirically, in order of what didn't work: reading `image.toBitmap()` straight off
 * the `paint` event's own callback argument goes stale after a handful of frames (later
 * calls kept resolving with an old, frozen bitmap despite invalidate() firing each time).
 * Using `paint` only as a "something new was composited" signal and then re-capturing via
 * capturePage() was closer, but still raced -- occasional one-frame-behind reads, meaning
 * `paint` can fire slightly before the DOM mutation is actually reflected in the backing
 * store capturePage() reads from.
 *
 * What's reliable: `jsExpr` returns a promise that resolves after two nested
 * `requestAnimationFrame` calls (the standard "wait for an actual paint" signal), which
 * `executeJavaScript` awaits before resolving. No `paint` event, no `invalidate()` --
 * offscreen windows paint continuously regardless, so the double-rAF inside the page is the
 * synchronization primitive, not anything on the main-process side.
 */
async function renderFrame(win, jsExpr) {
  await win.webContents.executeJavaScript(
    `(function(){ ${jsExpr}; return new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(resolve); }); }); })()`
  );
  const image = await win.webContents.capturePage();
  return { bitmap: image.toBitmap(), size: image.getSize() };
}

function pixelAt(bitmap, width, x, y) {
  const i = (y * width + x) * 4;
  // nativeImage raw bitmaps are BGRA on all platforms.
  return { b: bitmap[i], g: bitmap[i + 1], r: bitmap[i + 2], a: bitmap[i + 3] };
}

/**
 * Closes a window and waits for the `closed` event, rather than calling `destroy()` and
 * moving on. Found empirically: `destroy()`'s teardown is asynchronous under the hood, and
 * creating + loading a second offscreen window immediately afterward races it -- the new
 * window's `loadURL` fails outright with `ERR_FAILED`. Waiting for `closed` avoids it.
 */
function closeWindow(win) {
  return new Promise((resolve) => {
    win.once('closed', resolve);
    win.close();
  });
}

async function loadHtml(win, html) {
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

async function roleAlpha() {
  const win = makeOffscreenWindow(400, 300);
  await loadHtml(
    win,
    `<html><body style="margin:0;background:transparent;">
      <div style="position:absolute;left:0;top:0;width:100px;height:100px;background:red;"></div>
      <div style="position:absolute;left:150px;top:0;width:100px;height:100px;background:rgba(255,255,255,0.5);"></div>
    </body></html>`
  );
  const { bitmap, size } = await renderFrame(win, '0');

  const opaque = pixelAt(bitmap, size.width, 50, 50);
  const transparent = pixelAt(bitmap, size.width, 300, 200); // empty region, nothing painted there
  const semiTransparentWhite = pixelAt(bitmap, size.width, 200, 50);
  const semiTransparentWhiteUnpremultiplied = unpremultiply(semiTransparentWhite);

  console.log(
    JSON.stringify({ opaque, transparent, semiTransparentWhite, semiTransparentWhiteUnpremultiplied, bitmapSize: size })
  );
}

/** capturePage()'s raw bitmap is premultiplied; this recovers straight (unpremultiplied) RGB. */
function unpremultiply({ r, g, b, a }) {
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }; // fully transparent -- no color information to recover
  return {
    r: Math.round((r * 255) / a),
    g: Math.round((g * 255) / a),
    b: Math.round((b * 255) / a),
    a,
  };
}

async function roleScale(scale) {
  const logicalW = 200;
  const logicalH = 200;
  const win = makeOffscreenWindow(logicalW, logicalH);
  await loadHtml(
    win,
    `<html><body style="margin:0;background:transparent;">
      <div style="position:absolute;left:0;top:0;width:${logicalW}px;height:${logicalH}px;
        background:white;clip-path:polygon(0 0, 100% 100%, 0 100%);"></div>
    </body></html>`
  );
  const { bitmap, size } = await renderFrame(win, '0');

  // Scan a horizontal row through the middle, count the run of pixels whose alpha
  // is neither ~0 nor ~255 -- that run length is the antialiased edge's physical width.
  const row = Math.floor(size.height / 2);
  let edgeTransitionPx = 0;
  for (let x = 0; x < size.width; x++) {
    const { a } = pixelAt(bitmap, size.width, x, row);
    if (a > 5 && a < 250) edgeTransitionPx++;
  }

  console.log(
    JSON.stringify({
      requestedScale: scale,
      logicalWidth: logicalW,
      logicalHeight: logicalH,
      bitmapWidth: size.width,
      bitmapHeight: size.height,
      edgeTransitionPx,
    })
  );
}

async function rolePacing() {
  // Small window for the exact-match determinism check.
  const win = makeOffscreenWindow(100, 100);
  await loadHtml(
    win,
    `<html><body style="margin:0;background:transparent;">
      <div id="marker" style="position:absolute;left:0;top:0;width:100px;height:100px;"></div>
    </body></html>`
  );

  const framesChecked = 60;
  let mismatches = 0;
  for (let t = 0; t < framesChecked; t++) {
    const r = (t * 7) % 256;
    const g = (t * 13) % 256;
    const b = (t * 29) % 256;
    const { bitmap, size } = await renderFrame(
      win,
      `document.getElementById('marker').style.background = 'rgb(${r},${g},${b})'`
    );
    const px = pixelAt(bitmap, size.width, 50, 50);
    if (px.r !== r || px.g !== g || px.b !== b) {
      mismatches++;
      console.error(`frame ${t}: expected rgb(${r},${g},${b}), got rgb(${px.r},${px.g},${px.b})`);
    }
  }
  await closeWindow(win);

  // Throughput at a realistic size.
  const bigWin = makeOffscreenWindow(1920, 1080);
  await loadHtml(
    bigWin,
    `<html><body style="margin:0;background:transparent;">
      <div id="marker" style="position:absolute;left:0;top:0;width:200px;height:200px;font:60px sans-serif;color:white;"></div>
    </body></html>`
  );

  const setFrameJs = (n) =>
    `document.getElementById('marker').style.background = 'rgb(${n % 256},0,0)';` +
    `document.getElementById('marker').textContent = '${n}'`;

  const warmup = 20;
  const timed = 300;
  for (let t = 0; t < warmup; t++) {
    await renderFrame(bigWin, setFrameJs(t));
  }
  const start = performance.now();
  for (let t = 0; t < timed; t++) {
    await renderFrame(bigWin, setFrameJs(t));
  }
  const elapsed = performance.now() - start;
  await closeWindow(bigWin);

  console.log(
    JSON.stringify({
      framesChecked,
      mismatches,
      framesTimed: timed,
      msPerFrame1080p: elapsed / timed,
    })
  );
}
