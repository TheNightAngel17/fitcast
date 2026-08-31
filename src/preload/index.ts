/**
 * Preload script — exposes a narrow, typed API to the renderer via contextBridge.
 * No generic "call any IPC channel" escape hatch.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { RideData } from '../shared/ride-data';

export interface FitCastAPI {
  // File operations
  openFitDialog: () => Promise<string | null>;
  parseFitFile: (filePath: string) => Promise<RideData>;

  // Settings
  getSetting: (key: string) => Promise<unknown>;
  setSetting: (key: string, value: unknown) => Promise<void>;

  // Render
  checkFfmpeg: () => Promise<{ available: boolean; version?: string; error?: string }>;
  startRender: (options: {
    outputPath: string;
    codec: string;
    width: number;
    height: number;
    fps: number;
    startOffset: number;
    duration: number;
  }) => Promise<{ status: string; message?: string }>;
  cancelRender: () => Promise<void>;
  chooseOutputDir: () => Promise<string | null>;

  // ANT+ Broadcasting
  startBroadcast: () => Promise<{ status: string }>;
  stopBroadcast: () => Promise<{ status: string }>;
  /** `endOffset` stops playback partway through the ride; omit to run to the end. */
  startPlayback: (options: { startOffset: number; endOffset?: number }) => Promise<{ status: string }>;
  stopPlayback: () => Promise<{ status: string }>;
  getAntStatus: () => Promise<{
    status: string;
    elapsedSeconds: number;
    error?: string;
    lastPower: number;
    lastCadence: number;
    lastHeartRate: number;
  }>;
  getAntDeviceIds: () => Promise<{ power: number; heartRate: number; cadence: number }>;
  setAntDeviceIds: (ids: { power: number; heartRate: number; cadence: number }) => Promise<void>;

  // Drag and drop — renderer sends path, main does the read
  onFileDrop: (callback: (filePath: string) => void) => () => void;
}

const api: FitCastAPI = {
  openFitDialog: () => ipcRenderer.invoke('dialog:openFit'),
  parseFitFile: (filePath) => ipcRenderer.invoke('fit:parse', filePath),

  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),

  checkFfmpeg: () => ipcRenderer.invoke('render:checkFfmpeg'),
  startRender: (options) => ipcRenderer.invoke('render:start', options),
  cancelRender: () => ipcRenderer.invoke('render:cancel'),
  chooseOutputDir: () => ipcRenderer.invoke('dialog:chooseOutputDir'),

  startBroadcast: () => ipcRenderer.invoke('ant:startBroadcast'),
  stopBroadcast: () => ipcRenderer.invoke('ant:stopBroadcast'),
  startPlayback: (options) => ipcRenderer.invoke('ant:startPlayback', options),
  stopPlayback: () => ipcRenderer.invoke('ant:stopPlayback'),
  getAntStatus: () => ipcRenderer.invoke('ant:getStatus'),
  getAntDeviceIds: () => ipcRenderer.invoke('ant:getDeviceIds'),
  setAntDeviceIds: (ids) => ipcRenderer.invoke('ant:setDeviceIds', ids),

  onFileDrop: (callback) => {
    const handler = (_event: unknown, filePath: string): void => {
      callback(filePath);
    };
    ipcRenderer.on('file:dropped', handler);
    return () => {
      ipcRenderer.removeListener('file:dropped', handler);
    };
  },
};

contextBridge.exposeInMainWorld('fitcast', api);
