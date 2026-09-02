/**
 * SVG path builders for decimated series.
 *
 * `decimateChannel` emits `null` where the ride has a real recording gap, so
 * both builders break the path there instead of drawing a straight line across
 * the pause. Each contiguous run becomes its own subpath.
 */

import type { Bucket } from '../../../../shared/timeline';

type ValueOf = (b: Bucket) => number;

/** Split a bucket list into contiguous runs, dropping the gap markers. */
function runs(buckets: (Bucket | null)[]): Bucket[][] {
  const out: Bucket[][] = [];
  let current: Bucket[] = [];

  for (const b of buckets) {
    if (b === null) {
      if (current.length > 0) out.push(current);
      current = [];
    } else {
      current.push(b);
    }
  }
  if (current.length > 0) out.push(current);

  return out;
}

/** A stroked line through each run. Single-point runs become a 1px dash so they stay visible. */
export function linePath(
  buckets: (Bucket | null)[],
  valueOf: ValueOf,
  xOf: (t: number) => number,
  yOf: (v: number) => number
): string {
  let d = '';

  for (const run of runs(buckets)) {
    run.forEach((b, i) => {
      const x = xOf(b.t).toFixed(2);
      const y = yOf(valueOf(b)).toFixed(2);
      d += i === 0 ? `M${x},${y}` : `L${x},${y}`;
    });
    if (run.length === 1) {
      const b = run[0];
      d += `L${(xOf(b.t) + 0.5).toFixed(2)},${yOf(valueOf(b)).toFixed(2)}`;
    }
  }

  return d;
}

/** A filled area between each run and the baseline. */
export function areaPath(
  buckets: (Bucket | null)[],
  valueOf: ValueOf,
  xOf: (t: number) => number,
  yOf: (v: number) => number,
  baseY: number
): string {
  let d = '';
  const base = baseY.toFixed(2);

  for (const run of runs(buckets)) {
    const firstX = xOf(run[0].t).toFixed(2);
    const lastX = xOf(run[run.length - 1].t).toFixed(2);

    d += `M${firstX},${base}`;
    for (const b of run) {
      d += `L${xOf(b.t).toFixed(2)},${yOf(valueOf(b)).toFixed(2)}`;
    }
    d += `L${lastX},${base}Z`;
  }

  return d;
}

/** A colour plateau: a contiguous run of columns that share one zone colour. */
interface ColorGroup {
  color: string;
  startX: number;
  endX: number;
}

/**
 * Colour each point by its own value, like a flat vertical bar per column,
 * but blend across a short pixel-wide band exactly where the colour changes
 * instead of a hard edge — a single column that happens to nudge into the
 * next zone no longer reads as a stray flag of colour against its neighbours.
 * Within a zone the fill stays flat; the blend only appears at the crossing.
 *
 * Returns one combined area (and gradient stop list) per contiguous run, so
 * the DOM cost stays proportional to the number of real recording gaps, not
 * to the number of zone crossings.
 */
export function zoneGradientRuns(
  buckets: (Bucket | null)[],
  valueOf: ValueOf,
  xOf: (t: number) => number,
  yOf: (v: number) => number,
  baseY: number,
  colorOf: (v: number) => string,
  transitionPx: number
): { d: string; x1: number; x2: number; stops: { offset: number; color: string }[] }[] {
  const out: { d: string; x1: number; x2: number; stops: { offset: number; color: string }[] }[] = [];
  const base = baseY.toFixed(2);

  for (const run of runs(buckets)) {
    const firstX = xOf(run[0].t);
    const lastX = xOf(run[run.length - 1].t);

    let d = `M${firstX.toFixed(2)},${base}`;
    for (const b of run) {
      d += `L${xOf(b.t).toFixed(2)},${yOf(valueOf(b)).toFixed(2)}`;
    }
    d += `L${lastX.toFixed(2)},${base}Z`;

    const groups: ColorGroup[] = [];
    let i = 0;
    while (i < run.length) {
      const color = colorOf(valueOf(run[i]));
      let j = i + 1;
      while (j < run.length && colorOf(valueOf(run[j])) === color) j++;
      groups.push({ color, startX: xOf(run[i].t), endX: xOf(run[j - 1].t) });
      i = j;
    }

    const span = Math.max(lastX - firstX, 1e-6);
    const stopsX: { x: number; color: string }[] = [];

    groups.forEach((g, gi) => {
      const prev = groups[gi - 1];
      const next = groups[gi + 1];

      if (!prev) {
        stopsX.push({ x: g.startX, color: g.color });
      } else {
        const boundary = (prev.endX + g.startX) / 2;
        const half = Math.min(transitionPx / 2, (g.endX - g.startX) / 2, (prev.endX - prev.startX) / 2);
        stopsX.push({ x: boundary + half, color: g.color });
      }

      if (!next) {
        stopsX.push({ x: g.endX, color: g.color });
      } else {
        const boundary = (g.endX + next.startX) / 2;
        const half = Math.min(transitionPx / 2, (g.endX - g.startX) / 2, (next.endX - next.startX) / 2);
        stopsX.push({ x: boundary - half, color: g.color });
      }
    });

    const stops = stopsX.map(({ x, color }) => ({
      offset: Math.min(Math.max((x - firstX) / span, 0), 1),
      color,
    }));
    // SVG gradients require non-decreasing offsets; a very narrow group
    // sandwiched between two transitions can otherwise land out of order.
    for (let k = 1; k < stops.length; k++) {
      if (stops[k].offset < stops[k - 1].offset) stops[k].offset = stops[k - 1].offset;
    }

    out.push({ d, x1: firstX, x2: lastX, stops });
  }

  return out;
}
