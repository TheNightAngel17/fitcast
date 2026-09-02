/**
 * Pure chart math for the ride timeline.
 *
 * Lives in `shared/` (not the renderer) so it can be unit-tested — vitest runs
 * with `environment: 'node'` and no jsdom, so React components are untestable
 * but pure modules like this one are not.
 *
 * Everything here works off `elapsedSeconds`, never sample index. The parser
 * only forward-fills gaps <= 5s (see fit-parser.ts), so gaps longer than that
 * are genuine holes in `samples` and index-based plotting would visually
 * compress long pauses.
 */

import type { RideSample } from './ride-data';

/** A selected time window, in seconds elapsed from ride start. */
export interface RangeSelection {
  start: number;
  end: number;
}

/** One plot column: the min/max/avg of every sample that fell into it. */
export interface Bucket {
  /** Midpoint time of the column, in elapsed seconds. */
  t: number;
  min: number;
  max: number;
  avg: number;
}

/** Numeric channels that can be plotted. */
export type ChannelKey = 'power' | 'heartRate' | 'cadence' | 'speed' | 'altitude';

/** Shortest selection the brush will allow, in seconds. */
export const MIN_SELECTION_SECONDS = 5;

/** Default gap threshold — matches MAX_FORWARD_FILL_GAP in fit-parser.ts. */
export const DEFAULT_GAP_THRESHOLD_SECONDS = 5;

/**
 * Coggan power zones, as an upper bound expressed in fractions of FTP.
 * Drives the solid fill colour of each point on the power area — see
 * zoneColorForValue().
 */
export const POWER_ZONES: { name: string; fracOfFtp: number; color: string }[] = [
  { name: 'Active Recovery', fracOfFtp: 0.55, color: '#5b8def' },
  { name: 'Endurance', fracOfFtp: 0.75, color: '#4fb3d9' },
  { name: 'Tempo', fracOfFtp: 0.9, color: '#5cc98a' },
  { name: 'Threshold', fracOfFtp: 1.05, color: '#e8d64a' },
  { name: 'VO2 Max', fracOfFtp: 1.2, color: '#f0932b' },
  { name: 'Anaerobic', fracOfFtp: 1.5, color: '#eb4d4b' },
  { name: 'Neuromuscular', fracOfFtp: Infinity, color: '#a3243b' },
];

/**
 * Bucket a channel into `columns` evenly-spaced time columns over [t0, t1].
 *
 * Columns with no data are dropped rather than emitted as zeros. A `null` is
 * inserted between two adjacent buckets only when the time between them
 * exceeds `gapThresholdSeconds` — that marks a real recording pause, which the
 * caller should render as a break in the line. Zooming in far enough that
 * there are more columns than samples does *not* produce nulls.
 */
export function decimateChannel(
  samples: RideSample[],
  channel: ChannelKey,
  t0: number,
  t1: number,
  columns: number,
  gapThresholdSeconds: number = DEFAULT_GAP_THRESHOLD_SECONDS
): (Bucket | null)[] {
  if (columns <= 0 || t1 <= t0 || samples.length === 0) return [];

  const span = t1 - t0;
  // Accumulators, one slot per column. Parallel arrays keep this allocation-light
  // on rides with tens of thousands of samples.
  const count = new Float64Array(columns);
  const sum = new Float64Array(columns);
  const min = new Float64Array(columns);
  const max = new Float64Array(columns);
  const tSum = new Float64Array(columns);
  // Earliest/latest sample time in each column. Gaps are measured between these,
  // not between column midpoints — at low column counts the columns themselves
  // are wider than the gap threshold and would otherwise all read as gaps.
  const tFirst = new Float64Array(columns);
  const tLast = new Float64Array(columns);

  for (const s of samples) {
    const t = s.elapsedSeconds;
    if (t < t0 || t > t1) continue;
    const v = s[channel];
    if (v === null || !Number.isFinite(v)) continue;

    let idx = Math.floor(((t - t0) / span) * columns);
    if (idx >= columns) idx = columns - 1; // t === t1 lands one past the end
    if (idx < 0) idx = 0;

    if (count[idx] === 0) {
      min[idx] = v;
      max[idx] = v;
      tFirst[idx] = t;
    } else {
      if (v < min[idx]) min[idx] = v;
      if (v > max[idx]) max[idx] = v;
    }
    tLast[idx] = t;
    count[idx] += 1;
    sum[idx] += v;
    tSum[idx] += t;
  }

  const out: (Bucket | null)[] = [];
  let prevLastT: number | null = null;

  for (let i = 0; i < columns; i++) {
    if (count[i] === 0) continue;
    if (prevLastT !== null && tFirst[i] - prevLastT > gapThresholdSeconds) {
      out.push(null);
    }
    out.push({
      t: tSum[i] / count[i],
      min: min[i],
      max: max[i],
      avg: sum[i] / count[i],
    });
    prevLastT = tLast[i];
  }

  return out;
}

/**
 * Min/max of a channel over [t0, t1], ignoring nulls and out-of-range samples.
 * Returns null when the range contains no data for that channel.
 */
export function channelExtent(
  samples: RideSample[],
  channel: ChannelKey,
  t0: number,
  t1: number
): { min: number; max: number } | null {
  let lo = Infinity;
  let hi = -Infinity;

  for (const s of samples) {
    const t = s.elapsedSeconds;
    if (t < t0 || t > t1) continue;
    const v = s[channel];
    if (v === null || !Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }

  if (lo === Infinity) return null;
  return { min: lo, max: hi };
}

/**
 * Normalize a selection: swap if reversed, clamp into [0, total], and widen to
 * at least MIN_SELECTION_SECONDS without sliding outside the ride.
 */
export function clampSelection(sel: RangeSelection, total: number): RangeSelection {
  if (!(total > 0)) return { start: 0, end: 0 };

  let start = Number.isFinite(sel.start) ? sel.start : 0;
  let end = Number.isFinite(sel.end) ? sel.end : total;
  if (start > end) [start, end] = [end, start];

  start = Math.min(Math.max(start, 0), total);
  end = Math.min(Math.max(end, 0), total);

  const minSpan = Math.min(MIN_SELECTION_SECONDS, total);
  if (end - start < minSpan) {
    if (start + minSpan <= total) {
      end = start + minSpan;
    } else {
      end = total;
      start = total - minSpan;
    }
  }

  return { start, end };
}

/** How many gridline intervals the axis helpers aim for. */
const TARGET_TICKS = 6;

/**
 * A friendly gridline interval for an axis spanning `range`, chosen so the axis
 * ends up with roughly TARGET_TICKS divisions: 1/2/2.5/5/10 x a power of ten.
 */
export function niceStep(range: number, targetTicks: number = TARGET_TICKS): number {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const raw = range / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const step = [1, 2, 2.5, 5, 10].find((s) => normalized <= s + 1e-9) ?? 10;
  return step * magnitude;
}

/**
 * Round up to a friendly axis ceiling that lands on a gridline:
 * 487 -> 500, 1143 -> 1200, 178 -> 200.
 */
export function niceCeiling(v: number, targetTicks: number = TARGET_TICKS): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const step = niceStep(v, targetTicks);
  return Math.ceil(v / step - 1e-9) * step;
}

/**
 * The zone colour for a single power value. Each point on the power chart is
 * coloured solidly by its own value — a column that peaks in Zone 4 is Zone 4
 * coloured for its entire height, not shaded through the zones beneath it.
 *
 * Callers must only invoke this with a usable FTP (> 0); the flat, zone-less
 * fallback for missing FTP belongs in the caller, not here.
 */
export function zoneColorForValue(value: number, ftp: number): string {
  for (const zone of POWER_ZONES) {
    if (value <= zone.fracOfFtp * ftp) return zone.color;
  }
  return POWER_ZONES[POWER_ZONES.length - 1].color;
}
