/**
 * Normalized ride data model — the contract both render and playback pipelines consume.
 *
 * All channels are nullable because not every ride has every sensor.
 * Everything is keyed off `elapsedSeconds` from ride start, not sample index.
 */

/** A single time-indexed data sample from a ride. */
export interface RideSample {
  /** Seconds elapsed since ride start (monotonically increasing, may have gaps). */
  elapsedSeconds: number;
  /** Absolute timestamp (JS Date epoch ms). */
  timestamp: number;
  /** Instantaneous power in watts. */
  power: number | null;
  /** Cadence in RPM. */
  cadence: number | null;
  /** Heart rate in BPM. */
  heartRate: number | null;
  /** Speed in m/s. */
  speed: number | null;
  /** Altitude/elevation in meters. */
  altitude: number | null;
  /** Cumulative distance in meters from ride start. */
  distance: number | null;
  /** Temperature in °C, if available. */
  temperature: number | null;
}

/** Which data channels are present in this ride. */
export interface AvailableChannels {
  power: boolean;
  cadence: boolean;
  heartRate: boolean;
  speed: boolean;
  altitude: boolean;
  distance: boolean;
  temperature: boolean;
}

/** Computed summary statistics for the ride. */
export interface RideSummary {
  avgPower: number | null;
  maxPower: number | null;
  normalizedPower: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  avgCadence: number | null;
  maxCadence: number | null;
  avgSpeed: number | null;
  maxSpeed: number | null;
  totalDistance: number | null;
  totalElevationGain: number | null;
}

/** The complete parsed ride, consumed by both pipelines. */
export interface RideData {
  /** Absolute start time (JS Date epoch ms). */
  startTimestamp: number;
  /** Total elapsed duration in seconds (last sample - first sample). */
  totalElapsedSeconds: number;
  /** Moving time in seconds (excludes pauses/stops if detectable). */
  movingTimeSeconds: number;
  /** Total number of samples. */
  sampleCount: number;
  /** Which channels this ride contains. */
  channels: AvailableChannels;
  /** Computed summary statistics. */
  summary: RideSummary;
  /** Time-indexed samples, sorted by elapsedSeconds ascending. */
  samples: RideSample[];
}

/**
 * Look up the sample at a given elapsed time, with linear interpolation
 * between adjacent samples. Used by both render and playback pipelines
 * so they can never drift apart in interpretation.
 *
 * Returns null if t is outside the ride's range.
 */
export function sampleAtElapsedSeconds(
  ride: RideData,
  t: number
): RideSample | null {
  const { samples } = ride;
  if (samples.length === 0) return null;
  if (t < samples[0].elapsedSeconds) return null;
  if (t >= samples[samples.length - 1].elapsedSeconds) {
    return { ...samples[samples.length - 1] };
  }

  // Binary search for the bounding samples
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid].elapsedSeconds <= t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const a = samples[lo];
  const b = samples[hi];
  const span = b.elapsedSeconds - a.elapsedSeconds;
  if (span === 0) return { ...a };

  const frac = (t - a.elapsedSeconds) / span;
  return interpolateSamples(a, b, frac);
}

/** Linearly interpolate between two samples. If one side is null, uses the other (forward-fill); if both null, returns null. */
function interpolateSamples(
  a: RideSample,
  b: RideSample,
  frac: number
): RideSample {
  const lerp = (
    va: number | null,
    vb: number | null
  ): number | null => {
    if (va === null || vb === null) return va ?? vb ?? null;
    return va + (vb - va) * frac;
  };

  return {
    elapsedSeconds: a.elapsedSeconds + (b.elapsedSeconds - a.elapsedSeconds) * frac,
    timestamp: a.timestamp + (b.timestamp - a.timestamp) * frac,
    power: lerp(a.power, b.power),
    cadence: lerp(a.cadence, b.cadence),
    heartRate: lerp(a.heartRate, b.heartRate),
    speed: lerp(a.speed, b.speed),
    altitude: lerp(a.altitude, b.altitude),
    distance: lerp(a.distance, b.distance),
    temperature: lerp(a.temperature, b.temperature),
  };
}

/**
 * Format elapsed seconds as HH:MM:SS.
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
