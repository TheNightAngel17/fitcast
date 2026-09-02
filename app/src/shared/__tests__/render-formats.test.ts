import { describe, it, expect } from 'vitest';
import {
  RENDER_FORMATS,
  DEFAULT_RENDER_FORMAT_ID,
  DEFAULT_FRAME_RATE_ID,
  FRAME_RATE_PRESETS,
  renderFormatById,
  resolveRenderFormat,
  resolveFrameRate,
  frameRateById,
  frameRateToFps,
  frameRateToFfmpeg,
  frameCount,
  validateDimensions,
  resolveOutputTarget,
  ffmpegEncodeArgs,
} from '../render-formats';

describe('render formats', () => {
  it('offers only formats Premiere can read alpha from', () => {
    const ids = RENDER_FORMATS.map((f) => f.id);
    expect(ids).toEqual(['prores4444', 'png-sequence']);
    // VP9/WebM is disqualified: Premiere cannot read its alpha channel.
    expect(ids).not.toContain('vp9');
  });

  it('defaults to ProRes 4444', () => {
    expect(resolveRenderFormat(undefined).id).toBe(DEFAULT_RENDER_FORMAT_ID);
    expect(DEFAULT_RENDER_FORMAT_ID).toBe('prores4444');
  });

  it('falls back to the default for stale or unknown stored ids', () => {
    // 'vp9' is exactly what an existing settings store would hold.
    expect(resolveRenderFormat('vp9').id).toBe('prores4444');
    expect(resolveRenderFormat(42).id).toBe('prores4444');
    expect(renderFormatById('vp9')).toBeUndefined();
  });

  it('marks the PNG sequence as needing no ffmpeg', () => {
    expect(renderFormatById('png-sequence')?.requiresFfmpeg).toBe(false);
    expect(renderFormatById('prores4444')?.requiresFfmpeg).toBe(true);
  });
});

describe('frame rates', () => {
  it('carries NTSC rates as exact rationals, never decimals', () => {
    expect(frameRateById('29.97')).toMatchObject({ num: 30000, den: 1001 });
    expect(frameRateById('23.976')).toMatchObject({ num: 24000, den: 1001 });
    expect(frameRateById('59.94')).toMatchObject({ num: 60000, den: 1001 });
  });

  it('defaults to 29.97, the rate cameras mean when they say 30', () => {
    expect(resolveFrameRate(undefined).id).toBe(DEFAULT_FRAME_RATE_ID);
    expect(DEFAULT_FRAME_RATE_ID).toBe('29.97');
  });

  it('formats fractional rates as num/den and integers bare', () => {
    expect(frameRateToFfmpeg({ num: 30000, den: 1001 })).toBe('30000/1001');
    expect(frameRateToFfmpeg({ num: 30, den: 1 })).toBe('30');
  });

  it('keeps 30 and 29.97 distinct — they drift 3.6s over an hour', () => {
    const thirty = frameRateToFps(frameRateById('30')!);
    const ntsc = frameRateToFps(frameRateById('29.97')!);
    expect(thirty).not.toBe(ntsc);
    const driftOverAnHour = Math.abs(frameCount(3600, { num: 30, den: 1 }) / thirty - 3600);
    const ntscSeconds = frameCount(3600, { num: 30000, den: 1001 }) / thirty;
    expect(driftOverAnHour).toBeLessThan(0.001);
    expect(Math.abs(3600 - ntscSeconds)).toBeGreaterThan(3.5);
  });

  it('migrates a legacy bare fps number to the matching preset', () => {
    // The old UI stored a free-text number; 30 must stay 30, not become 29.97.
    expect(resolveFrameRate(30).id).toBe('30');
    expect(resolveFrameRate(60).id).toBe('60');
    expect(resolveFrameRate(29.97).id).toBe('29.97');
    expect(resolveFrameRate(23.976).id).toBe('23.976');
  });

  it('accepts a stored rational and unknown values fall back', () => {
    expect(resolveFrameRate({ num: 30000, den: 1001 }).id).toBe('29.97');
    expect(resolveFrameRate({ num: 1, den: 0 }).id).toBe(DEFAULT_FRAME_RATE_ID);
    expect(resolveFrameRate(0).id).toBe(DEFAULT_FRAME_RATE_ID);
    expect(resolveFrameRate(999).id).toBe(DEFAULT_FRAME_RATE_ID);
  });

  it('counts frames across a range', () => {
    expect(frameCount(10, { num: 30, den: 1 })).toBe(300);
    expect(frameCount(0, { num: 30, den: 1 })).toBe(0);
    expect(frameCount(-5, { num: 30, den: 1 })).toBe(0);
  });

  it('gives every preset a unique id', () => {
    const ids = FRAME_RATE_PRESETS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('dimension validation', () => {
  it('accepts even dimensions', () => {
    expect(validateDimensions(1920, 1080)).toBeNull();
    expect(validateDimensions(640, 360)).toBeNull();
  });

  it('rejects odd dimensions before ffmpeg can fail obscurely', () => {
    expect(validateDimensions(1921, 1080)).toMatch(/even/);
    expect(validateDimensions(1920, 1081)).toMatch(/even/);
  });

  it('rejects non-integer and degenerate sizes', () => {
    expect(validateDimensions(19.5, 1080)).toMatch(/whole numbers/);
    expect(validateDimensions(0, 1080)).toMatch(/at least 2/);
  });
});

describe('output targets', () => {
  it('writes a single .mov for ProRes', () => {
    const target = resolveOutputTarget('/out', renderFormatById('prores4444')!);
    expect(target).toEqual({ path: '/out/fitcast_overlay.mov', isDirectory: false });
  });

  it('writes a directory for the PNG sequence', () => {
    const target = resolveOutputTarget('/out', renderFormatById('png-sequence')!);
    expect(target).toEqual({ path: '/out/fitcast_overlay_frames', isDirectory: true });
  });
});

describe('ffmpeg invocation', () => {
  const args = ffmpegEncodeArgs({
    format: renderFormatById('prores4444')!,
    frameRate: { num: 30000, den: 1001 },
    outputPath: '/out/overlay.mov',
  });

  it('encodes ProRes 4444 with an alpha-carrying pixel format', () => {
    expect(args).toContain('prores_ks');
    expect(args[args.indexOf('-profile:v') + 1]).toBe('4444');
    // yuva444p12le is the alpha-carrying format ProRes 4444 stores natively.
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe('yuva444p12le');
    expect(args[args.indexOf('-alpha_bits') + 1]).toBe('16');
  });

  it('passes the fractional rate through unrounded on both input and output', () => {
    expect(args[args.indexOf('-framerate') + 1]).toBe('30000/1001');
    expect(args[args.indexOf('-r') + 1]).toBe('30000/1001');
    expect(args).not.toContain('29.97');
  });

  it('reads piped frames and writes the output path last', () => {
    expect(args[args.indexOf('-f') + 1]).toBe('image2pipe');
    expect(args[args.indexOf('-i') + 1]).toBe('-');
    expect(args[args.length - 1]).toBe('/out/overlay.mov');
  });

  it('never premultiplies alpha', () => {
    // Premultiplying halos antialiased text, which is most of the overlay.
    expect(args.join(' ')).not.toMatch(/premultiply/);
  });

  it('refuses to build args for a format ffmpeg does not produce', () => {
    expect(() =>
      ffmpegEncodeArgs({
        format: renderFormatById('png-sequence')!,
        frameRate: { num: 30, den: 1 },
        outputPath: '/out/frames',
      })
    ).toThrow(/written directly by the capture/);
  });
});
