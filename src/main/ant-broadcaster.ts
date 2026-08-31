/**
 * ANT+ Broadcaster — manages ANT+ sensor broadcasts.
 *
 * Two-phase operation:
 * 1. Start Broadcasting: idle broadcast (zeros) so receivers can discover & pair
 * 2. Start Playback: replay .fit data in real-time over the already-open broadcast
 *
 * Attempts real USB hardware via incyclist-ant-plus. If the device fails to open
 * (not plugged in, wrong driver, etc.) it falls back to simulation mode which
 * logs correct payloads at the right cadence without touching hardware.
 */

import { AntDevice } from 'incyclist-ant-plus/lib/bindings';
import { Messages } from 'incyclist-ant-plus';
import type { RideData } from '../shared/ride-data';
import { sampleAtElapsedSeconds } from '../shared/ride-data';

// ANT+ profile constants
const DEVICE_TYPE_POWER = 0x0b;
const DEVICE_TYPE_HR = 0x78;
const DEVICE_TYPE_CADENCE = 0x7a;
const TX_TYPE_POWER = 0x05;
const TX_TYPE_SENSOR = 0x01;
const RF_FREQUENCY = 57; // 2.4 GHz ANT band
const PERIOD_POWER = 8182; // ~4 Hz
const PERIOD_HR = 8070; // ~4 Hz
const PERIOD_CADENCE = 8102; // ~4 Hz

export interface DeviceIds {
  power: number;
  heartRate: number;
  cadence: number;
}

export type BroadcastStatus = 'idle' | 'broadcasting' | 'playing' | 'error';

interface BroadcastState {
  status: BroadcastStatus;
  elapsedSeconds: number;
  error?: string;
  lastPower: number;
  lastCadence: number;
  lastHeartRate: number;
}

interface PowerAccumulator {
  eventCount: number; // 0-255, rolls over
  accumulatedPower: number; // 0-65535, rolls over
}

interface CadenceAccumulator {
  eventCount: number; // cumulative revolution count, 0-65535
  eventTime: number; // last event time in 1/1024s units, 0-65535
}

interface HrAccumulator {
  beatCount: number; // 0-255, rolls over
  beatTime: number; // last beat time in 1/1024s units, 0-65535
}

// Minimal interface for what we need from a channel object
interface AntChannel {
  getChannelNo(): number;
  sendMessage(data: Buffer, opts?: { timeout?: number }): Promise<unknown>;
}

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export class AntBroadcaster {
  private log: Logger;
  private rideData: RideData | null = null;
  private status: BroadcastStatus = 'idle';
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private playbackStartTime: number | null = null;
  private playbackOffset = 0;
  private error: string | null = null;
  private simulated = true;
  private _hwTick = 0; // for debug log throttling in hardware path

  // Hardware
  private antDevice: AntDevice | null = null;
  private pwrChannel: AntChannel | null = null;
  private hrChannel: AntChannel | null = null;
  private cadChannel: AntChannel | null = null;

  // ANT+ accumulators
  private powerAcc: PowerAccumulator = { eventCount: 0, accumulatedPower: 0 };
  private cadenceAcc: CadenceAccumulator = { eventCount: 0, eventTime: 0 };
  private hrAcc: HrAccumulator = { beatCount: 0, beatTime: 0 };

  // Current values
  private currentPower = 0;
  private currentCadence = 0;
  private currentHeartRate = 0;

  private readonly BROADCAST_INTERVAL_MS = 250; // 4 Hz

  constructor(logger: Logger) {
    this.log = logger;
  }

  /**
   * Phase 1: Open hardware (or fall back to sim), broadcast idle/zero data
   * so receivers can discover and pair before playback starts.
   */
  async startBroadcasting(
    rideData: RideData,
    deviceIds: DeviceIds = { power: 12345, heartRate: 12346, cadence: 12347 }
  ): Promise<{ status: BroadcastStatus }> {
    this.rideData = rideData;
    this.resetAccumulators();
    this.currentPower = 0;
    this.currentCadence = 0;
    this.currentHeartRate = 0;
    this.error = null;

    try {
      this.antDevice = new AntDevice({ startupTimeout: 3000 });
      const opened = await this.antDevice.open();
      if (!opened) {
        this.log.warn('[ANT+] Device.open() returned false — falling back to simulation');
        await this.closeChannels();
      } else {
        await this.openChannels(deviceIds);
        this.simulated = false;
        this.log.info(
          '[ANT+] Hardware broadcasting started (power=%d hr=%d cad=%d)',
          deviceIds.power,
          deviceIds.heartRate,
          deviceIds.cadence
        );
      }
    } catch (err) {
      this.log.warn('[ANT+] Hardware error, falling back to simulation:', err);
      await this.closeChannels();
    }

    this.status = 'broadcasting';
    this.startBroadcastLoop();
    return { status: this.status };
  }

  /**
   * Phase 2: Start replaying .fit data over the already-open broadcast.
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

    // Diagnostic: confirm what channels are present and spot-check cadence values
    if (process.env.ANT_DEBUG === '1') {
      const rd = this.rideData;
      this.log.info('[ANT+] Ride channels: power=%s cadence=%s hr=%s', rd.channels.power, rd.channels.cadence, rd.channels.heartRate);
      const spots = [0, Math.floor(rd.samples.length / 2), rd.samples.length - 1];
      for (const idx of spots) {
        const s = rd.samples[idx];
        if (s) this.log.info('[ANT+] sample[%d] t=%ds power=%s cad=%s hr=%s', idx, Math.round(s.elapsedSeconds), s.power, s.cadence, s.heartRate);
      }
    }
    this.log.info('[ANT+] Starting playback from offset %ds', startOffset);
    return { status: this.status };
  }

  /** Stop playback but keep broadcasting idle data. */
  stopPlayback(): { status: BroadcastStatus } {
    if (this.status !== 'playing') return { status: this.status };
    this.playbackStartTime = null;
    this.currentPower = 0;
    this.currentCadence = 0;
    this.currentHeartRate = 0;
    this.status = 'broadcasting';
    this.log.info('[ANT+] Playback stopped, returning to idle broadcast');
    return { status: this.status };
  }

  /** Stop everything — close channels and release hardware. */
  async stopBroadcasting(): Promise<{ status: BroadcastStatus }> {
    this.stopBroadcastLoop();
    this.playbackStartTime = null;
    await this.closeChannels();
    this.status = 'idle';
    this.log.info('[ANT+] Broadcast stopped');
    return { status: this.status };
  }

  /** Alias for cleanup on quit. */
  stopAll(): void {
    this.stopBroadcastLoop();
    this.closeChannels().catch(() => {});
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

  // ─── Hardware setup/teardown ──────────────────────────────────────────

  private async openChannels(deviceIds: DeviceIds): Promise<void> {
    const ant = this.antDevice!;

    // Power channel
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.pwrChannel = (ant as any).getChannel() as AntChannel | null;
    if (!this.pwrChannel) throw new Error('No ANT+ channels available');
    const pwrNo = this.pwrChannel.getChannelNo();
    await this.pwrChannel.sendMessage(Messages.assignChannel(pwrNo, 'transmit'), { timeout: 2000 });
    await this.pwrChannel.sendMessage(Messages.setDevice(pwrNo, deviceIds.power, DEVICE_TYPE_POWER, TX_TYPE_POWER), { timeout: 2000 });
    await this.pwrChannel.sendMessage(Messages.setFrequency(pwrNo, RF_FREQUENCY), { timeout: 2000 });
    await this.pwrChannel.sendMessage(Messages.setPeriod(pwrNo, PERIOD_POWER), { timeout: 2000 });
    await this.pwrChannel.sendMessage(Messages.openChannel(pwrNo), { timeout: 2000 });
    this.log.info('[ANT+] Power channel %d opened (device ID %d)', pwrNo, deviceIds.power);

    // HR channel
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.hrChannel = (ant as any).getChannel() as AntChannel | null;
    if (!this.hrChannel) throw new Error('No ANT+ channels available for HR');
    const hrNo = this.hrChannel.getChannelNo();
    await this.hrChannel.sendMessage(Messages.assignChannel(hrNo, 'transmit'), { timeout: 2000 });
    await this.hrChannel.sendMessage(Messages.setDevice(hrNo, deviceIds.heartRate, DEVICE_TYPE_HR, TX_TYPE_SENSOR), { timeout: 2000 });
    await this.hrChannel.sendMessage(Messages.setFrequency(hrNo, RF_FREQUENCY), { timeout: 2000 });
    await this.hrChannel.sendMessage(Messages.setPeriod(hrNo, PERIOD_HR), { timeout: 2000 });
    await this.hrChannel.sendMessage(Messages.openChannel(hrNo), { timeout: 2000 });
    this.log.info('[ANT+] HR channel %d opened (device ID %d)', hrNo, deviceIds.heartRate);

    // Cadence channel
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.cadChannel = (ant as any).getChannel() as AntChannel | null;
    if (!this.cadChannel) throw new Error('No ANT+ channels available for cadence');
    const cadNo = this.cadChannel.getChannelNo();
    await this.cadChannel.sendMessage(Messages.assignChannel(cadNo, 'transmit'), { timeout: 2000 });
    await this.cadChannel.sendMessage(Messages.setDevice(cadNo, deviceIds.cadence, DEVICE_TYPE_CADENCE, TX_TYPE_SENSOR), { timeout: 2000 });
    await this.cadChannel.sendMessage(Messages.setFrequency(cadNo, RF_FREQUENCY), { timeout: 2000 });
    await this.cadChannel.sendMessage(Messages.setPeriod(cadNo, PERIOD_CADENCE), { timeout: 2000 });
    await this.cadChannel.sendMessage(Messages.openChannel(cadNo), { timeout: 2000 });
    this.log.info('[ANT+] Cadence channel %d opened (device ID %d)', cadNo, deviceIds.cadence);
  }

  private async closeChannels(): Promise<void> {
    const tryClose = async (ch: AntChannel | null): Promise<void> => {
      if (!ch) return;
      try {
        await ch.sendMessage(Messages.closeChannel(ch.getChannelNo()), { timeout: 1000 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.antDevice as any)?.freeChannel(ch);
      } catch {
        // best-effort
      }
    };

    await Promise.all([
      tryClose(this.pwrChannel),
      tryClose(this.hrChannel),
      tryClose(this.cadChannel),
    ]);
    this.pwrChannel = null;
    this.hrChannel = null;
    this.cadChannel = null;

    if (this.antDevice) {
      try {
        await this.antDevice.close();
      } catch {
        // best-effort
      }
      this.antDevice = null;
    }
    this.simulated = true;
  }

  // ─── Broadcast loop ───────────────────────────────────────────────────

  /**
   * Drift-corrected broadcast loop. Each tick is scheduled against the
   * absolute start time to prevent accumulation error over long replays.
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
          // Log raw sample values every 4 ticks (1s) to aid debugging
          if (process.env.ANT_DEBUG === '1' && tickCount % 4 === 0) {
            this.log.info('[ANT+ DBG] t=%.1fs raw: power=%s cad=%s hr=%s → using: %dW %drpm %dbpm',
              elapsed, sample.power, sample.cadence, sample.heartRate,
              this.currentPower, this.currentCadence, this.currentHeartRate);
          }
        } else {
          this.log.info('[ANT+] Playback reached end of ride data');
          this.stopPlayback();
        }
      }

      this.updatePowerAccumulator();
      this.updateCadenceAccumulator();
      this.updateHrAccumulator();

      if (this.simulated) {
        this.log.info(
          '[ANT+ SIM] Power: %dW (evt:%d acc:%d) | Cadence: %drpm (rev:%d) | HR: %dbpm (beat:%d)',
          this.currentPower, this.powerAcc.eventCount, this.powerAcc.accumulatedPower,
          this.currentCadence, this.cadenceAcc.eventCount,
          this.currentHeartRate, this.hrAcc.beatCount,
        );
      } else {
        this.sendHardwarePayloads();
      }

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

  private sendHardwarePayloads(): void {
    if (!this.antDevice) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const write = (buf: Buffer): void => {
      try {
        (this.antDevice as any).write(buf);
      } catch (err) {
        this.log.warn('[ANT+] Hardware write failed, falling back to simulation:', err);
        this.error = err instanceof Error ? err.message : String(err);
        this.simulated = true;
      }
    };
    this._hwTick++;

    // Power-Only Data Page 0x10 (ANT+ Bicycle Power profile)
    // [channelNo, pageNum, updateEventCount, 0xFF(pedal power N/A), cadence,
    //  accPower_lo, accPower_hi, power_lo, power_hi]
    if (this.pwrChannel) {
      const pwrNo = this.pwrChannel.getChannelNo();
      const { accumulatedPower: ap, eventCount: ec } = this.powerAcc;
      const pwrBuf = Messages.broadcastData([
        pwrNo,
        0x10,
        ec & 0xff,
        0xff,
        this.currentCadence & 0xff,
        ap & 0xff,
        (ap >> 8) & 0xff,
        this.currentPower & 0xff,
        (this.currentPower >> 8) & 0xff,
      ]);
      if (this._hwTick % 4 === 1) {
        this.log.info('[ANT+ DBG PWR] ch=%d pwr=%dW cad=%drpm ec=%d bytes=%s',
          pwrNo, this.currentPower, this.currentCadence, ec,
          [...pwrBuf].map((b) => b.toString(16).padStart(2, '0')).join(' '));
      }
      write(pwrBuf);
    }

    // Heart Rate Data Page 0x00 (ANT+ HR profile, universal page)
    // [channelNo, 0x00, 0xFF, 0xFF, 0xFF,
    //  beatTime_lo, beatTime_hi, beatCount, computedHR]
    if (this.hrChannel) {
      const hrNo = this.hrChannel.getChannelNo();
      const { beatTime: bt, beatCount: bc } = this.hrAcc;
      write(Messages.broadcastData([
        hrNo,
        0x00,
        0xff,
        0xff,
        0xff,
        bt & 0xff,
        (bt >> 8) & 0xff,
        bc & 0xff,
        this.currentHeartRate & 0xff,
      ]));
    }

    // Bike Cadence Data Page 0x00 (ANT+ Cadence profile, universal page)
    // [channelNo, 0x00, 0xFF, 0xFF, 0xFF,
    //  eventTime_lo, eventTime_hi, revCount_lo, revCount_hi]
    if (this.cadChannel) {
      const cadNo = this.cadChannel.getChannelNo();
      const { eventTime: et, eventCount: rev } = this.cadenceAcc;
      const cadBuf = Messages.broadcastData([
        cadNo,
        0x00,
        0xff,
        0xff,
        0xff,
        et & 0xff,
        (et >> 8) & 0xff,
        rev & 0xff,
        (rev >> 8) & 0xff,
      ]);
      if (this._hwTick % 4 === 1) {
        this.log.info('[ANT+ DBG CAD] ch=%d cad=%drpm et=%d rev=%d bytes=%s',
          cadNo, this.currentCadence, et, rev,
          [...cadBuf].map((b) => b.toString(16).padStart(2, '0')).join(' '));
      }
      write(cadBuf);
    }
  }

  // ─── Accumulators ─────────────────────────────────────────────────────

  private resetAccumulators(): void {
    this.powerAcc = { eventCount: 0, accumulatedPower: 0 };
    this.cadenceAcc = { eventCount: 0, eventTime: 0 };
    this.hrAcc = { beatCount: 0, beatTime: 0 };
  }

  /**
   * ANT+ Power-Only Data Page (0x10) accumulator.
   * Event count and accumulated power both roll over at their spec maximums.
   */
  private updatePowerAccumulator(): void {
    if (this.currentPower > 0) {
      this.powerAcc.eventCount = (this.powerAcc.eventCount + 1) & 0xff;
      this.powerAcc.accumulatedPower =
        (this.powerAcc.accumulatedPower + this.currentPower) & 0xffff;
    }
  }

  /**
   * ANT+ Bike Cadence accumulator.
   * Event time in 1/1024s units tracks crank revolution timing.
   */
  private updateCadenceAccumulator(): void {
    if (this.currentCadence > 0) {
      const secPerRev = 60 / this.currentCadence;
      const timeIncrement = Math.round(secPerRev * 1024);
      this.cadenceAcc.eventTime = (this.cadenceAcc.eventTime + timeIncrement) & 0xffff;
      this.cadenceAcc.eventCount = (this.cadenceAcc.eventCount + 1) & 0xffff;
    }
  }

  /**
   * ANT+ Heart Rate accumulator.
   * Beat time in 1/1024s units tracks heartbeat timing.
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
