/**
 * .fit file parser — wraps fit-file-parser and normalizes output
 * into the shared RideData model.
 *
 * Gap handling strategy:
 * - Short gaps (<=5s): forward-fill from the last known sample
 * - Long gaps (>5s): leave the gap (no synthetic samples inserted), but the
 *   elapsedSeconds counter keeps ticking so playback stays time-accurate.
 * - Null channels: if a field is missing from a record, it stays null.
 *
 * FIT timestamps use a custom epoch (seconds since 1989-12-31T00:00:00Z).
 * fit-file-parser converts these to JS Date objects for us.
 */

import {
  RideData,
  RideSample,
  RideSummary,
  AvailableChannels,
} from './ride-data';

// fit-file-parser's record shape (loosely typed since the library isn't fully typed)
interface FitRecord {
  timestamp?: Date;
  power?: number;
  cadence?: number;
  heart_rate?: number;
  speed?: number;
  altitude?: number;
  distance?: number;
  temperature?: number;
  [key: string]: unknown;
}

interface FitSession {
  start_time?: Date;
  total_elapsed_time?: number;
  total_timer_time?: number;
  avg_power?: number;
  max_power?: number;
  normalized_power?: number;
  avg_heart_rate?: number;
  max_heart_rate?: number;
  avg_cadence?: number;
  max_cadence?: number;
  avg_speed?: number;
  max_speed?: number;
  total_distance?: number;
  total_ascent?: number;
  [key: string]: unknown;
}

interface FitData {
  records?: FitRecord[];
  sessions?: FitSession[];
  [key: string]: unknown;
}

/** Maximum gap in seconds before we stop forward-filling. */
const MAX_FORWARD_FILL_GAP = 5;

/**
 * Parse a .fit file buffer into a normalized RideData object.
 */
export async function parseFitFile(buffer: Buffer): Promise<RideData> {
  // Dynamic import since fit-file-parser is CJS
  const FitParser = (await import('fit-file-parser')).default;
  const parser = new FitParser({
    force: true,
    speedUnit: 'm/s',
    lengthUnit: 'm',
    temperatureUnit: 'celsius',
    elapsedRecordField: true,
    mode: 'list',
  });

  // fit-file-parser's types require a Buffer/ArrayBuffer backed strictly by
  // ArrayBuffer, but Node's Buffer type is backed by ArrayBufferLike (which
  // also permits SharedArrayBuffer). Copy into a fresh ArrayBuffer to satisfy
  // the stricter type without changing behavior for normal (non-shared) input.
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;

  return new Promise((resolve, reject) => {
    parser.parse(arrayBuffer, (error, data) => {
      if (error) {
        reject(new Error(`Failed to parse .fit file: ${error}`));
        return;
      }
      try {
        resolve(buildRideData((data ?? {}) as unknown as FitData));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function buildRideData(data: FitData): RideData {
  const records = data.records ?? [];
  if (records.length === 0) {
    throw new Error('No records found in .fit file');
  }

  // Find start timestamp from first record or session
  const session = data.sessions?.[0];
  const firstRecord = records[0];
  const startTime = session?.start_time ?? firstRecord.timestamp;
  if (!startTime) {
    throw new Error('No timestamp found in .fit file records');
  }
  const startMs = startTime.getTime();

  // Build samples
  const samples: RideSample[] = [];
  let lastSample: RideSample | null = null;

  for (const rec of records) {
    if (!rec.timestamp) continue;

    const timestamp = rec.timestamp.getTime();
    const elapsedSeconds = (timestamp - startMs) / 1000;
    if (elapsedSeconds < 0) continue;

    const sample: RideSample = {
      elapsedSeconds,
      timestamp,
      power: rec.power ?? null,
      cadence: rec.cadence ?? null,
      heartRate: rec.heart_rate ?? null,
      speed: rec.speed ?? null,
      altitude: rec.altitude ?? null,
      distance: rec.distance ?? null,
      temperature: rec.temperature ?? null,
    };

    // Forward-fill short gaps
    if (lastSample !== null) {
      const gap = elapsedSeconds - lastSample.elapsedSeconds;
      if (gap > 1 && gap <= MAX_FORWARD_FILL_GAP) {
        // Insert synthetic forward-filled samples for each missing second
        for (let t = Math.ceil(lastSample.elapsedSeconds + 1); t < elapsedSeconds; t++) {
          samples.push({
            ...lastSample,
            elapsedSeconds: t,
            timestamp: startMs + t * 1000,
          });
        }
      }
    }

    samples.push(sample);
    lastSample = sample;
  }

  if (samples.length === 0) {
    throw new Error('No valid timestamped records found in .fit file');
  }

  // Detect available channels
  const channels: AvailableChannels = {
    power: samples.some((s) => s.power !== null),
    cadence: samples.some((s) => s.cadence !== null),
    heartRate: samples.some((s) => s.heartRate !== null),
    speed: samples.some((s) => s.speed !== null),
    altitude: samples.some((s) => s.altitude !== null),
    distance: samples.some((s) => s.distance !== null),
    temperature: samples.some((s) => s.temperature !== null),
  };

  // Compute summary from session data or from samples
  const summary = buildSummary(session, samples, channels);

  const totalElapsed = samples[samples.length - 1].elapsedSeconds;
  const movingTime = session?.total_timer_time ?? totalElapsed;

  return {
    startTimestamp: startMs,
    totalElapsedSeconds: totalElapsed,
    movingTimeSeconds: movingTime,
    sampleCount: samples.length,
    channels,
    summary,
    samples,
  };
}

function buildSummary(
  session: FitSession | undefined,
  samples: RideSample[],
  channels: AvailableChannels
): RideSummary {
  // Prefer session-level stats when available, compute from samples as fallback
  const avg = (getter: (s: RideSample) => number | null): number | null => {
    const vals = samples.map(getter).filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  const max = (getter: (s: RideSample) => number | null): number | null => {
    const vals = samples.map(getter).filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    return Math.max(...vals);
  };

  // Elevation gain: sum positive deltas
  let elevGain: number | null = null;
  if (channels.altitude) {
    if (session?.total_ascent != null) {
      elevGain = session.total_ascent;
    } else {
      elevGain = 0;
      let prev: number | null = null;
      for (const s of samples) {
        if (s.altitude !== null) {
          if (prev !== null && s.altitude > prev) {
            elevGain += s.altitude - prev;
          }
          prev = s.altitude;
        }
      }
    }
  }

  return {
    avgPower: session?.avg_power ?? avg((s) => s.power),
    maxPower: session?.max_power ?? max((s) => s.power),
    normalizedPower: session?.normalized_power ?? null,
    avgHeartRate: session?.avg_heart_rate ?? avg((s) => s.heartRate),
    maxHeartRate: session?.max_heart_rate ?? max((s) => s.heartRate),
    avgCadence: session?.avg_cadence ?? avg((s) => s.cadence),
    maxCadence: session?.max_cadence ?? max((s) => s.cadence),
    avgSpeed: session?.avg_speed ?? avg((s) => s.speed),
    maxSpeed: session?.max_speed ?? max((s) => s.speed),
    totalDistance: session?.total_distance ?? samples[samples.length - 1]?.distance ?? null,
    totalElevationGain: elevGain,
  };
}
