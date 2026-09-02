/**
 * Tests for the shared ride data model.
 */

import { describe, it, expect } from 'vitest';
import { sampleAtElapsedSeconds, formatDuration } from '../ride-data';
import type { RideData, RideSample } from '../ride-data';

function makeSample(elapsed: number, power: number | null = null): RideSample {
  return {
    elapsedSeconds: elapsed,
    timestamp: 1000000 + elapsed * 1000,
    power,
    cadence: null,
    heartRate: null,
    speed: null,
    altitude: null,
    distance: null,
    temperature: null,
  };
}

function makeRide(samples: RideSample[]): RideData {
  return {
    startTimestamp: samples[0]?.timestamp ?? 0,
    totalElapsedSeconds: samples.length > 0 ? samples[samples.length - 1].elapsedSeconds : 0,
    movingTimeSeconds: 0,
    sampleCount: samples.length,
    channels: {
      power: false, cadence: false, heartRate: false,
      speed: false, altitude: false, distance: false, temperature: false,
    },
    summary: {
      avgPower: null, maxPower: null, normalizedPower: null,
      avgHeartRate: null, maxHeartRate: null,
      avgCadence: null, maxCadence: null,
      avgSpeed: null, maxSpeed: null,
      totalDistance: null, totalElevationGain: null,
    },
    samples,
  };
}

describe('sampleAtElapsedSeconds', () => {
  it('returns null for empty ride', () => {
    const ride = makeRide([]);
    expect(sampleAtElapsedSeconds(ride, 0)).toBeNull();
  });

  it('returns null for time before ride start', () => {
    const ride = makeRide([makeSample(5, 200)]);
    expect(sampleAtElapsedSeconds(ride, 3)).toBeNull();
  });

  it('returns exact sample when time matches', () => {
    const ride = makeRide([makeSample(0, 100), makeSample(10, 200)]);
    const s = sampleAtElapsedSeconds(ride, 0);
    expect(s?.power).toBe(100);
  });

  it('returns last sample at end of ride', () => {
    const ride = makeRide([makeSample(0, 100), makeSample(10, 200)]);
    const s = sampleAtElapsedSeconds(ride, 10);
    expect(s?.power).toBe(200);
  });

  it('interpolates between samples', () => {
    const ride = makeRide([makeSample(0, 100), makeSample(10, 200)]);
    const s = sampleAtElapsedSeconds(ride, 5);
    expect(s?.power).toBeCloseTo(150);
    expect(s?.elapsedSeconds).toBeCloseTo(5);
  });

  it('interpolates correctly at 25%', () => {
    const ride = makeRide([makeSample(0, 0), makeSample(100, 400)]);
    const s = sampleAtElapsedSeconds(ride, 25);
    expect(s?.power).toBeCloseTo(100);
  });
});

describe('formatDuration', () => {
  it('formats zero', () => {
    expect(formatDuration(0)).toBe('0:00:00');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('formats large durations', () => {
    expect(formatDuration(7200)).toBe('2:00:00');
  });
});
