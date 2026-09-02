/**
 * Settings store — persists user preferences using electron-store.
 */

import Store from 'electron-store';
import { DEFAULT_RENDER_FORMAT_ID, DEFAULT_FRAME_RATE_ID } from '../shared/render-formats';

export interface AppSettings {
  outputDir?: string;
  /**
   * Render output format id — see `shared/render-formats`. Read it through
   * `resolveRenderFormat()`: stores written before VP9 was dropped still hold
   * `'vp9'`, which no longer names a format.
   */
  codec?: string;
  resolution?: { width: number; height: number };
  /**
   * Frame-rate preset id, e.g. `'29.97'`. Read it through `resolveFrameRate()`,
   * which also accepts the bare number the old free-text fps input stored.
   */
  fps?: string | number;
  antDeviceIds?: {
    power: number;
    heartRate: number;
    cadence: number;
  };
  antSimulated?: boolean;
  /** Functional threshold power in watts — drives timeline zone colouring. */
  ftp?: number;
  obsWebsocketUrl?: string;
  obsWebsocketPassword?: string;
}

export class SettingsStore {
  private store: Store<AppSettings>;

  constructor() {
    this.store = new Store<AppSettings>({
      name: 'fitcast-settings',
      defaults: {
        codec: DEFAULT_RENDER_FORMAT_ID,
        resolution: { width: 1920, height: 1080 },
        fps: DEFAULT_FRAME_RATE_ID,
        antDeviceIds: {
          power: 12345,
          heartRate: 12346,
          cadence: 12347,
        },
        antSimulated: true,
        ftp: 250,
      },
    });
  }

  get(key: string): unknown {
    return this.store.get(key as keyof AppSettings);
  }

  set(key: string, value: unknown): void {
    this.store.set(key as keyof AppSettings, value);
  }
}
