/**
 * Tests for the timeline chart math.
 * Uses the real .fit file in example-data/ for a realistic decimation check.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parseFitFile } from '../fit-parser';
import type { RideSample } from '../ride-data';
import {
  decimateChannel,
  channelExtent,
  clampSelection,
  niceCeiling,
  niceStep,
  zoneColorForValue,
  POWER_ZONES,
  MIN_SELECTION_SECONDS,
} from '../timeline';

const FIXTURE_PATH = join(__dirname, '../../../example-data/24162810642_ACTIVITY.fit');

/** Build a sample with only the fields a test cares about. */
function sample(elapsedSeconds: number, overrides: Partial<RideSample> = {}): RideSample {
  return {
    elapsedSeconds,
    timestamp: 1_600_000_000_000 + elapsedSeconds * 1000,
    power: null,
    cadence: null,
    heartRate: null,
    speed: null,
    altitude: null,
    distance: null,
    temperature: null,
    ...overrides,
  };
}

/** One sample per second over [0, seconds), power = f(t). */
function ramp(seconds: number, f: (t: number) => number | null): RideSample[] {
  return Array.from({ length: seconds }, (_, t) => sample(t, { power: f(t) }));
}

describe('decimateChannel', () => {
  it('produces one bucket per column when samples are dense', () => {
    const samples = ramp(100, (t) => t);
    const buckets = decimateChannel(samples, 'power', 0, 100, 10);

    expect(buckets).toHaveLength(10);
    expect(buckets.every((b) => b !== null)).toBe(true);
  });

  it('computes min/max/avg over the samples in each column', () => {
    const samples = ramp(100, (t) => t);
    const buckets = decimateChannel(samples, 'power', 0, 100, 10);

    // First column covers t in [0, 10) -> powers 0..9
    expect(buckets[0]).toEqual({ t: 4.5, min: 0, max: 9, avg: 4.5 });
    // Last column covers t in [90, 100) -> powers 90..99
    expect(buckets[9]).toEqual({ t: 94.5, min: 90, max: 99, avg: 94.5 });
  });

  it('ignores samples outside [t0, t1]', () => {
    const samples = ramp(100, (t) => t);
    const buckets = decimateChannel(samples, 'power', 40, 60, 2);

    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ min: 40, max: 49 });
    expect(buckets[1]).toMatchObject({ min: 50, max: 60 });
  });

  it('skips null values rather than treating them as zero', () => {
    const samples = ramp(20, (t) => (t < 10 ? 200 : null));
    const buckets = decimateChannel(samples, 'power', 0, 20, 2);

    // Second half has no power data at all, so no bucket is emitted for it.
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ min: 200, max: 200, avg: 200 });
  });

  it('returns an empty array when the channel is entirely null', () => {
    const samples = ramp(50, () => null);
    expect(decimateChannel(samples, 'power', 0, 50, 25)).toEqual([]);
  });

  it('inserts a null across a recording gap longer than the threshold', () => {
    // 0..9s of data, a 30s hole, then 40..49s of data.
    const samples = [
      ...ramp(10, () => 150),
      ...Array.from({ length: 10 }, (_, i) => sample(40 + i, { power: 250 })),
    ];
    const buckets = decimateChannel(samples, 'power', 0, 50, 50);

    const nullCount = buckets.filter((b) => b === null).length;
    expect(nullCount).toBe(1);

    // The break sits between the two blocks of data, not at either edge.
    const nullIndex = buckets.findIndex((b) => b === null);
    expect(nullIndex).toBeGreaterThan(0);
    expect(nullIndex).toBeLessThan(buckets.length - 1);
    expect(buckets[nullIndex - 1]).toMatchObject({ avg: 150 });
    expect(buckets[nullIndex + 1]).toMatchObject({ avg: 250 });
  });

  it('does not insert nulls for contiguous data', () => {
    const samples = ramp(600, (t) => t % 300);
    const buckets = decimateChannel(samples, 'power', 0, 600, 200);
    expect(buckets.some((b) => b === null)).toBe(false);
  });

  it('does not insert nulls merely because columns outnumber samples', () => {
    // 20 samples spread over 20s, asked for 500 columns. Most columns are
    // empty, but the data itself is contiguous — no break should appear.
    const samples = ramp(20, () => 180);
    const buckets = decimateChannel(samples, 'power', 0, 20, 500);

    expect(buckets).toHaveLength(20);
    expect(buckets.some((b) => b === null)).toBe(false);
  });

  it('respects a custom gap threshold', () => {
    // Data at 0..4s and 15..19s — an 11s hole.
    const samples = [
      ...ramp(5, () => 100),
      ...Array.from({ length: 5 }, (_, i) => sample(15 + i, { power: 200 })),
    ];

    expect(decimateChannel(samples, 'power', 0, 30, 30, 5).some((b) => b === null)).toBe(true);
    expect(decimateChannel(samples, 'power', 0, 30, 30, 60).some((b) => b === null)).toBe(false);
  });

  it('measures gaps between sample times, not between column midpoints', () => {
    // 10 columns over 100s makes each column 10s wide — wider than the 5s gap
    // threshold — but the underlying 1Hz data is contiguous, so no breaks.
    const buckets = decimateChannel(ramp(100, () => 150), 'power', 0, 100, 10);
    expect(buckets.some((b) => b === null)).toBe(false);
  });

  it('returns an empty array for degenerate inputs', () => {
    const samples = ramp(10, () => 100);
    expect(decimateChannel(samples, 'power', 0, 10, 0)).toEqual([]);
    expect(decimateChannel(samples, 'power', 10, 10, 5)).toEqual([]);
    expect(decimateChannel([], 'power', 0, 10, 5)).toEqual([]);
  });

  it('reads the heartRate channel independently of power', () => {
    const samples = [
      sample(0, { power: 100, heartRate: 120 }),
      sample(1, { power: 200, heartRate: null }),
      sample(2, { power: null, heartRate: 140 }),
    ];

    expect(decimateChannel(samples, 'power', 0, 3, 1)[0]).toMatchObject({ min: 100, max: 200 });
    expect(decimateChannel(samples, 'heartRate', 0, 3, 1)[0]).toMatchObject({ min: 120, max: 140 });
  });
});

describe('channelExtent', () => {
  it('returns the min/max over the requested range only', () => {
    const samples = ramp(100, (t) => t);
    expect(channelExtent(samples, 'power', 20, 30)).toEqual({ min: 20, max: 30 });
  });

  it('ignores nulls', () => {
    const samples = ramp(10, (t) => (t % 2 === 0 ? t : null));
    expect(channelExtent(samples, 'power', 0, 10)).toEqual({ min: 0, max: 8 });
  });

  it('returns null when the range has no data', () => {
    const samples = ramp(10, () => 100);
    expect(channelExtent(samples, 'power', 50, 60)).toBeNull();
    expect(channelExtent(samples, 'heartRate', 0, 10)).toBeNull();
  });
});

describe('clampSelection', () => {
  it('passes a valid selection through unchanged', () => {
    expect(clampSelection({ start: 100, end: 500 }, 1000)).toEqual({ start: 100, end: 500 });
  });

  it('clamps to the ride bounds', () => {
    expect(clampSelection({ start: -50, end: 5000 }, 1000)).toEqual({ start: 0, end: 1000 });
  });

  it('swaps a reversed selection', () => {
    expect(clampSelection({ start: 800, end: 200 }, 1000)).toEqual({ start: 200, end: 800 });
  });

  it('widens a selection shorter than the minimum', () => {
    const sel = clampSelection({ start: 500, end: 501 }, 1000);
    expect(sel.end - sel.start).toBe(MIN_SELECTION_SECONDS);
    expect(sel.start).toBe(500);
  });

  it('widens backwards when the minimum would overflow the ride end', () => {
    const sel = clampSelection({ start: 999, end: 1000 }, 1000);
    expect(sel).toEqual({ start: 1000 - MIN_SELECTION_SECONDS, end: 1000 });
  });

  it('handles rides shorter than the minimum selection', () => {
    expect(clampSelection({ start: 1, end: 2 }, 3)).toEqual({ start: 0, end: 3 });
  });

  it('handles a zero-length ride', () => {
    expect(clampSelection({ start: 0, end: 10 }, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('niceCeiling', () => {
  it('rounds up to a friendly axis maximum', () => {
    expect(niceCeiling(487)).toBe(500);
    expect(niceCeiling(1143)).toBe(1200);
    expect(niceCeiling(178)).toBe(200);
    expect(niceCeiling(42)).toBe(50);
  });

  it('lands on a multiple of the gridline step', () => {
    for (const v of [37, 178, 487, 953, 1143, 1687]) {
      const ceiling = niceCeiling(v);
      expect(ceiling).toBeGreaterThanOrEqual(v);
      expect(ceiling % niceStep(v)).toBeCloseTo(0);
    }
  });

  it('leaves values that are already round alone', () => {
    expect(niceCeiling(500)).toBe(500);
    expect(niceCeiling(1000)).toBe(1000);
  });

  it('returns 1 for non-positive or non-finite input', () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(-5)).toBe(1);
    expect(niceCeiling(NaN)).toBe(1);
  });
});

describe('zoneColorForValue', () => {
  const FTP = 250;

  it('picks the zone whose upper bound the value falls at or under', () => {
    expect(zoneColorForValue(100, FTP)).toBe(POWER_ZONES[0].color); // <= 55% * 250 = 137.5 -> Z1
    expect(zoneColorForValue(140, FTP)).toBe(POWER_ZONES[1].color); // <= 75% * 250 = 187.5 -> Z2
    expect(zoneColorForValue(250, FTP)).toBe(POWER_ZONES[3].color); // <= 105% * 250 = 262.5 -> Z4
  });

  it('is inclusive at a zone boundary — the boundary value lands in the lower zone', () => {
    expect(zoneColorForValue(137.5, FTP)).toBe(POWER_ZONES[0].color);
  });

  it('returns the top zone colour for power far above FTP', () => {
    expect(zoneColorForValue(10_000, FTP)).toBe(POWER_ZONES[POWER_ZONES.length - 1].color);
  });

  it('returns the bottom zone colour at zero power', () => {
    expect(zoneColorForValue(0, FTP)).toBe(POWER_ZONES[0].color);
  });
});

describe('against the example .fit file', () => {
  const hasFixture = existsSync(FIXTURE_PATH);

  it.skipIf(!hasFixture)('decimates a real ride without losing its peaks', async () => {
    const ride = await parseFitFile(Buffer.from(readFileSync(FIXTURE_PATH)));
    const columns = 1000;
    const buckets = decimateChannel(ride.samples, 'power', 0, ride.totalElapsedSeconds, columns);

    expect(buckets.length).toBeGreaterThan(0);
    // Nulls are extra entries, so the real bucket count still fits the columns.
    expect(buckets.filter((b) => b !== null).length).toBeLessThanOrEqual(columns);

    // Bucket times are strictly increasing across the gaps.
    const times = buckets.filter((b): b is NonNullable<typeof b> => b !== null).map((b) => b.t);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }

    // The max envelope must preserve the ride's true peak power — that is the
    // whole point of keeping min/max rather than averaging.
    const extent = channelExtent(ride.samples, 'power', 0, ride.totalElapsedSeconds);
    if (extent) {
      const bucketMax = Math.max(
        ...buckets.filter((b): b is NonNullable<typeof b> => b !== null).map((b) => b.max)
      );
      expect(bucketMax).toBe(extent.max);
    }
  });
});
