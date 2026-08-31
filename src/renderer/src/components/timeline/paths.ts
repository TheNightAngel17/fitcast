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
