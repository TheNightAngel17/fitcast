/**
 * Output format catalogue for render mode.
 *
 * Render mode exists to hand Premiere a pre-composited overlay, so every format
 * here must survive the trip with its alpha channel readable. That single
 * constraint is what prunes the list:
 *
 * - **ProRes 4444** — imported natively on Windows, alpha auto-detected. The default.
 * - **PNG sequence** — no encoder in the path at all, so alpha cannot be mangled.
 *   Also the diagnostic: if a render looks wrong, a sequence says immediately
 *   whether the fault is in the capture or the encode.
 *
 * VP9+alpha is deliberately absent. Premiere cannot import WebM natively, and the
 * usual third-party plugin writes alpha but cannot read it back — a `.webm` render
 * would import (at best) as an opaque black rectangle.
 *
 * QuickTime Animation is absent for a subtler reason: Premiere only accepts it
 * without delta frames, and forcing all-intra to comply makes it roughly twice
 * the size of ProRes. Apple has deprecated the codec besides.
 */

export type RenderFormatId = 'prores4444' | 'png-sequence';

export interface RenderFormat {
  readonly id: RenderFormatId;
  readonly label: string;
  /** File extension for single-file formats; `null` when the output is a directory of frames. */
  readonly extension: string | null;
  /** True when the output is a directory of numbered frames rather than one file. */
  readonly isSequence: boolean;
  /**
   * Whether producing this format needs ffmpeg on PATH. A PNG sequence is written
   * straight from the frame capture, so it renders fine on a machine without it.
   */
  readonly requiresFfmpeg: boolean;
}

export const RENDER_FORMATS: readonly RenderFormat[] = [
  {
    id: 'prores4444',
    label: 'ProRes 4444 (.mov)',
    extension: 'mov',
    isSequence: false,
    requiresFfmpeg: true,
  },
  {
    id: 'png-sequence',
    label: 'PNG sequence (folder)',
    extension: null,
    isSequence: true,
    requiresFfmpeg: false,
  },
];

export const DEFAULT_RENDER_FORMAT_ID: RenderFormatId = 'prores4444';

/** Filename pattern for the frames inside a PNG-sequence output directory. */
export const SEQUENCE_FRAME_PATTERN = 'frame_%06d.png';

export function renderFormatById(id: string): RenderFormat | undefined {
  return RENDER_FORMATS.find((f) => f.id === id);
}

/** Falls back to the default rather than throwing, so a stale stored value can't wedge the UI. */
export function resolveRenderFormat(id: unknown): RenderFormat {
  const found = typeof id === 'string' ? renderFormatById(id) : undefined;
  return found ?? renderFormatById(DEFAULT_RENDER_FORMAT_ID)!;
}

/**
 * Frame rates, carried as exact rationals.
 *
 * The fractional NTSC rates are the reason this is a preset list and not a number
 * input: 30 and 29.97 drift 3.6 seconds apart over an hour, and cameras that say
 * "30" in their menu overwhelmingly record 30000/1001. A decimal `29.97` rounded
 * anywhere in the chain reintroduces exactly the drift the preset exists to avoid,
 * so the numerator/denominator travel all the way to ffmpeg intact.
 */
export interface FrameRate {
  readonly num: number;
  readonly den: number;
}

export interface FrameRatePreset extends FrameRate {
  readonly id: string;
  readonly label: string;
}

export const FRAME_RATE_PRESETS: readonly FrameRatePreset[] = [
  { id: '23.976', label: '23.976 (24p NTSC)', num: 24000, den: 1001 },
  { id: '24', label: '24 (cinema)', num: 24, den: 1 },
  { id: '25', label: '25 (PAL)', num: 25, den: 1 },
  { id: '29.97', label: '29.97 (30p NTSC)', num: 30000, den: 1001 },
  { id: '30', label: '30', num: 30, den: 1 },
  { id: '50', label: '50 (PAL)', num: 50, den: 1 },
  { id: '59.94', label: '59.94 (60p NTSC)', num: 60000, den: 1001 },
  { id: '60', label: '60', num: 60, den: 1 },
];

/**
 * Cameras that offer "30" almost always mean 30000/1001, so this is the default
 * that leaves footage in sync for the widest range of users.
 */
export const DEFAULT_FRAME_RATE_ID = '29.97';

export function frameRateById(id: string): FrameRatePreset | undefined {
  return FRAME_RATE_PRESETS.find((r) => r.id === id);
}

/**
 * Accepts a preset id, a `{ num, den }` pair, or a bare number left over from the
 * old free-text fps input, and always lands on a preset. Bare numbers map to the
 * nearest preset within a hair's breadth, so a stored `30` stays 30 rather than
 * silently becoming 29.97.
 */
export function resolveFrameRate(stored: unknown): FrameRatePreset {
  if (typeof stored === 'string') {
    const byId = frameRateById(stored);
    if (byId) return byId;
  }

  if (typeof stored === 'object' && stored !== null) {
    const { num, den } = stored as Partial<FrameRate>;
    if (typeof num === 'number' && typeof den === 'number' && den !== 0) {
      const exact = FRAME_RATE_PRESETS.find((r) => r.num === num && r.den === den);
      if (exact) return exact;
      return matchDecimal(num / den);
    }
  }

  if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) {
    return matchDecimal(stored);
  }

  return frameRateById(DEFAULT_FRAME_RATE_ID)!;
}

function matchDecimal(fps: number): FrameRatePreset {
  const near = FRAME_RATE_PRESETS.find((r) => Math.abs(r.num / r.den - fps) < 0.01);
  return near ?? frameRateById(DEFAULT_FRAME_RATE_ID)!;
}

/** Decimal frames per second — for display and frame-count maths, never for ffmpeg. */
export function frameRateToFps(rate: FrameRate): number {
  return rate.num / rate.den;
}

/** The `num/den` string ffmpeg takes, keeping fractional rates exact. */
export function frameRateToFfmpeg(rate: FrameRate): string {
  return rate.den === 1 ? String(rate.num) : `${rate.num}/${rate.den}`;
}

/** How many frames a range of `durationSeconds` produces at this rate. */
export function frameCount(durationSeconds: number, rate: FrameRate): number {
  return Math.max(0, Math.round(durationSeconds * frameRateToFps(rate)));
}

/**
 * ProRes wants even dimensions; an odd width fails inside ffmpeg with a message
 * that never mentions the input box the user typed it into. A PNG sequence goes
 * through no encoder and has no such constraint, so the even-dimension check is
 * skipped for it — pass the target `format` to apply the right rule.
 */
export function validateDimensions(
  width: number,
  height: number,
  format: RenderFormat
): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return 'Width and height must be whole numbers';
  }
  if (width < 2 || height < 2) {
    return 'Width and height must be at least 2 pixels';
  }
  if (format.requiresFfmpeg && (width % 2 !== 0 || height % 2 !== 0)) {
    return 'Width and height must both be even numbers';
  }
  return null;
}

export interface RenderOutputTarget {
  /** File path for single-file formats, directory path for sequences. */
  readonly path: string;
  readonly isDirectory: boolean;
}

export function resolveOutputTarget(
  outputDir: string,
  format: RenderFormat,
  baseName = 'fitcast_overlay'
): RenderOutputTarget {
  if (format.isSequence) {
    return { path: `${outputDir}/${baseName}_frames`, isDirectory: true };
  }
  return { path: `${outputDir}/${baseName}.${format.extension}`, isDirectory: false };
}

export interface EncodeOptions {
  readonly format: RenderFormat;
  readonly frameRate: FrameRate;
  readonly outputPath: string;
}

/**
 * The complete argv for `spawn('ffmpeg', ...)`, encoding PNG frames piped in on
 * stdin by the headless-Chromium capture.
 *
 * Alpha stays **straight** (unpremultiplied) end to end: that is what Chromium's
 * captures contain and what Premiere expects from ProRes 4444. Premultiplying
 * anywhere in this chain shows up as dark haloing around antialiased text, which
 * is most of what the overlay is made of — so there is deliberately no
 * `premultiply`/`unpremultiply` filter here.
 *
 * `-vendor apl0` tags the stream as Apple-authored; without it some hosts refuse
 * to recognise prores_ks output. The pixel format is 12-bit because that is what
 * ProRes 4444 stores natively — asking for 10-bit just makes ffmpeg promote it.
 *
 * Verified end to end: RGBA frames with alpha spanning 0–255 decode back out of
 * the resulting .mov at 0–255. Explicit full-range flags (`-color_range pc`,
 * `scale=in_range=full`) make no difference and are deliberately omitted.
 */
export function ffmpegEncodeArgs(options: EncodeOptions): string[] {
  const { format, frameRate, outputPath } = options;

  if (!format.requiresFfmpeg) {
    throw new Error(`${format.label} is written directly by the capture, not by ffmpeg`);
  }

  const rate = frameRateToFfmpeg(frameRate);

  return [
    '-y',
    '-f',
    'image2pipe',
    '-framerate',
    rate,
    '-i',
    '-',
    '-c:v',
    'prores_ks',
    '-profile:v',
    '4444',
    '-pix_fmt',
    'yuva444p12le',
    '-alpha_bits',
    '16',
    '-vendor',
    'apl0',
    '-r',
    rate,
    outputPath,
  ];
}
