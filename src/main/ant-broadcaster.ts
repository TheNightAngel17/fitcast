/**
 * ANT+ Broadcaster — manages simulated ANT+ sensor broadcasts.
 *
 * Two-phase operation:
 * 1. Start Broadcasting: idle broadcast (zeros/placeholders) so receivers can discover & pair
 * 2. Start Playback: replay .fit data in real-time over the already-open broadcast
 *
 * Uses a mock/simulated mode by default (no USB hardware required) that logs
 * exact payloads at the correct cadence. Set ANT_SIMULATED=false env var
 * or settings to attempt real USB ANT+ stick connection.
 *
 * NOTE: Real ANT+ hardware broadcasting is UNVERIFIED — built without hardware.
 * The incyclist-ant-plus library is the intended real implementation, but it's
 * marked as a TODO until hardware testing is possible.
 */

import type { RideData } from '../shared/ride-data';
import { sampleAtElapsedSeconds } from '../shared/ride-data';

export type BroadcastStatus =
  | 'idle'
  | 'broadcasting'
  | 'playing'
  | 'error';

interface BroadcastState {
  status: BroadcastStatus;
  elapsedSeconds: number;
  error?: string;
  lastPower: number;
  lastCadence: number;
  lastHeartRate: number;
}

/**
 * ANT+ power data page accumulators.
 * Standard power-only page (0x10) uses rolling event count and accumulated power.
 * Receivers derive power from deltas between messages.
 */
interface PowerAccumulator {
  eventCount: number; // 0-255, rolls over
  accumulatedPower: number; // 0-65535, rolls over
}

interface CadenceAccumulator {
  eventCount: number; // bike cadence revolution count, 0-65535
  eventTime: number; // in 1/1024s units, 0-65535
}

interface HrAccumulator {
  beatCount: number; // 0-255
  beatTime: number; // in 1/1024s units, 0-65535
}

export class AntBroadcaster {
  private log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  private rideData: RideData | null = null;
  private status: BroadcastStatus = 'idle';
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private playbackStartTime: number | null = null;
  private playbackOffset = 0;
  private error: string | null = null;

  // ANT+ accumulators
  private powerAcc: PowerAccumulator = { eventCount: 0, accumulatedPower: 0 };
  private cadenceAcc: CadenceAccumulator = { eventCount: 0, eventTime: 0 };
  private hrAcc: HrAccumulator = { beatCount: 0, beatTime: 0 };

  // Current values
  private currentPower = 0;
  private currentCadence = 0;
  private currentHeartRate = 0;

  // Broadcast interval (ANT+ standard: ~4Hz for power, ~4Hz for HR)
  private readonly BROADCAST_INTERVAL_MS = 250; // 4Hz

  constructor(logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void }) {
    this.log = logger;
  }

  /**
   * Phase 1: Start broadcasting idle/zero data so receivers can discover and pair.
   */
  startBroadcasting(rideData: RideData): { status: BroadcastStatus } {
    this.rideData = rideData;
    this.resetAccumulators();
    this.currentPower = 0;
    this.currentCadence = 0;
    this.currentHeartRate = 0;
    this.error = null;

    this.log.info('[ANT+] Starting idle broadcast (simulated mode)');
    this.status = 'broadcasting';
    this.startBroadcastLoop();
    return { status: this.status };
  }

  /**
   * Phase 2: Start replaying .fit data over the broadcast.
   */
  startPlayback(startOffset: number): { status: BroadcastStatus } {
    if (this.status !== 'broadcasting') {
      throw new Error('Must be broadcasting before starting playback');
    }
    if (!this.rideData) {
      throw new Error('No ride data loaded');
    }

    this.playbackOffset = startOffset;
    this.playbackStartTime = Date.now();
    this.status = 'playing';
    this.log.info(`[ANT+] Starting playback from offset ${startOffset}s`);
    return { status: this.status };
  }

  /**
   * Stop playback but keep broadcasting idle data.
   */
  stopPlayback(): { status: BroadcastStatus } {
    if (this.status !== 'playing') {
      return { status: this.status };
    }
    this.playbackStartTime = null;
    this.currentPower = 0;
    this.currentCadence = 0;
    this.currentHeartRate = 0;
    this.status = 'broadcasting';
    this.log.info('[ANT+] Playback stopped, returning to idle broadcast');
    return { status: this.status };
  }

  /**
   * Stop everything — release channels.
   */
  stopBroadcasting(): { status: BroadcastStatus } {
    this.stopBroadcastLoop();
    this.playbackStartTime = null;
    this.status = 'idle';
    this.log.info('[ANT+] Broadcast stopped');
    return { status: this.status };
  }

  /** Alias for cleanup on quit. */
  stopAll(): void {
    this.stopBroadcasting();
  }

  getStatus(): BroadcastState {
    let elapsed = 0;
    if (this.playbackStartTime !== null) {
      elapsed = (Date.now() - this.playbackStartTime) / 1000 + this.playbackOffset;
    }
    return {
      status: this.status,
      elapsedSeconds: elapsed,
      error: this.error ?? undefined,
      lastPower: this.currentPower,
      lastCadence: this.currentCadence,
      lastHeartRate: this.currentHeartRate,
    };
  }

  // ─── Private ─────────────────────────────────────────────────────

  private resetAccumulators(): void {
    this.powerAcc = { eventCount: 0, accumulatedPower: 0 };
    this.cadenceAcc = { eventCount: 0, eventTime: 0 };
    this.hrAcc = { beatCount: 0, beatTime: 0 };
  }

  /**
   * Drift-corrected broadcast loop.
   * Each tick is scheduled against the absolute start time to prevent
   * accumulation error over long replays.
   */
  private startBroadcastLoop(): void {
    const startTime = Date.now();
    let tickCount = 0;

    const tick = (): void => {
      if (this.status === 'idle') return;

      // Update values from ride data if playing
      if (this.status === 'playing' && this.rideData && this.playbackStartTime) {
        const elapsed = (Date.now() - this.playbackStartTime) / 1000 + this.playbackOffset;
        const sample = sampleAtElapsedSeconds(this.rideData, elapsed);
        if (sample) {
          this.currentPower = Math.round(sample.power ?? 0);
          this.currentCadence = Math.round(sample.cadence ?? 0);
          this.currentHeartRate = Math.round(sample.heartRate ?? 0);
        } else {
          // Past end of ride
          this.log.info('[ANT+] Playback reached end of ride data');
          this.stopPlayback();
          return;
        }
      }

      // Update accumulators and build payloads
      this.updatePowerAccumulator();
      this.updateCadenceAccumulator();
      this.updateHrAccumulator();

      // Log the simulated broadcast
      this.log.info(
        `[ANT+ SIM] Power: ${this.currentPower}W (evt:${this.powerAcc.eventCount} acc:${this.powerAcc.accumulatedPower}) | ` +
        `Cadence: ${this.currentCadence}rpm (rev:${this.cadenceAcc.eventCount}) | ` +
        `HR: ${this.currentHeartRate}bpm (beat:${this.hrAcc.beatCount})`
      );

      // Schedule next tick with drift correction
      tickCount++;
      const nextTime = startTime + tickCount * this.BROADCAST_INTERVAL_MS;
      const delay = Math.max(0, nextTime - Date.now());
      this.broadcastTimer = setTimeout(tick, delay);
    };

    this.broadcastTimer = setTimeout(tick, this.BROADCAST_INTERVAL_MS);
  }

  private stopBroadcastLoop(): void {
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }
  }

  /**
   * ANT+ Power-Only Data Page (0x10) accumulator update.
   * Event count increments each "pedal event" (approx 1 per crank revolution).
   * Accumulated power adds instantaneous power each event.
   * Both roll over at their respective maximums.
   */
  private updatePowerAccumulator(): void {
    // Simulate ~1 event per 250ms when power > 0 (simplified)
    if (this.currentPower > 0) {
      this.powerAcc.eventCount = (this.powerAcc.eventCount + 1) & 0xff;
      this.powerAcc.accumulatedPower =
        (this.powerAcc.accumulatedPower + this.currentPower) & 0xffff;
    }
  }

  /**
   * ANT+ Bike Cadence accumulator.
   * Revolution count and event time (1/1024s) track crank revolutions.
   */
  private updateCadenceAccumulator(): void {
    if (this.currentCadence > 0) {
      // Time per revolution in 1/1024s units
      const secPerRev = 60 / this.currentCadence;
      const timeIncrement = Math.round(secPerRev * 1024);
      this.cadenceAcc.eventTime =
        (this.cadenceAcc.eventTime + timeIncrement) & 0xffff;
      this.cadenceAcc.eventCount =
        (this.cadenceAcc.eventCount + 1) & 0xffff;
    }
  }

  /**
   * ANT+ Heart Rate accumulator.
   * Beat count and beat event time (1/1024s).
   */
  private updateHrAccumulator(): void {
    if (this.currentHeartRate > 0) {
      const secPerBeat = 60 / this.currentHeartRate;
      const timeIncrement = Math.round(secPerBeat * 1024);
      this.hrAcc.beatTime = (this.hrAcc.beatTime + timeIncrement) & 0xffff;
      this.hrAcc.beatCount = (this.hrAcc.beatCount + 1) & 0xff;
    }
  }
}
