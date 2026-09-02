/**
 * Tests for .fit file parsing.
 * Uses the real .fit file in example-data/ if available.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parseFitFile } from '../fit-parser';

const FIXTURE_PATH = join(__dirname, '../../../example-data/24162810642_ACTIVITY.fit');

describe('parseFitFile', () => {
  // Only run if fixture exists
  const hasFixture = existsSync(FIXTURE_PATH);

  it.skipIf(!hasFixture)('parses the example .fit file', async () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const ride = await parseFitFile(Buffer.from(buffer));

    // Basic sanity checks
    expect(ride.sampleCount).toBeGreaterThan(0);
    expect(ride.totalElapsedSeconds).toBeGreaterThan(0);
    expect(ride.samples.length).toBeGreaterThan(0);

    // Start time should be a sane date (after 2000, before 2030)
    const startDate = new Date(ride.startTimestamp);
    expect(startDate.getFullYear()).toBeGreaterThanOrEqual(2000);
    expect(startDate.getFullYear()).toBeLessThanOrEqual(2030);

    // Samples should be sorted by elapsedSeconds
    for (let i = 1; i < ride.samples.length; i++) {
      expect(ride.samples[i].elapsedSeconds).toBeGreaterThanOrEqual(
        ride.samples[i - 1].elapsedSeconds
      );
    }

    // First sample should have elapsedSeconds >= 0
    expect(ride.samples[0].elapsedSeconds).toBeGreaterThanOrEqual(0);

    // At least some channels should be present
    const channelCount = Object.values(ride.channels).filter(Boolean).length;
    expect(channelCount).toBeGreaterThan(0);
  });

  it('rejects invalid data', async () => {
    const buf = Buffer.from('not a fit file');
    await expect(parseFitFile(buf)).rejects.toThrow();
  });
});
