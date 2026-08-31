/**
 * Settings store — persists user preferences using electron-store.
 */

import Store from 'electron-store';

export interface AppSettings {
  outputDir?: string;
  codec?: string;
  resolution?: { width: number; height: number };
  fps?: number;
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
        codec: 'prores',
        resolution: { width: 1920, height: 1080 },
        fps: 30,
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
