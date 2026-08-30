/**
 * FitCast — Electron main process.
 * Handles file I/O, .fit parsing, ANT+ broadcast, and render pipeline.
 */

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import log from 'electron-log/main';
import { parseFitFile } from '../shared/fit-parser';
import type { RideData } from '../shared/ride-data';
import { AntBroadcaster } from './ant-broadcaster';
import { checkFfmpeg } from './ffmpeg-check';
import { SettingsStore } from './settings';

// Configure logging
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.initialize();

let mainWindow: BrowserWindow | null = null;
let currentRideData: RideData | null = null;
const antBroadcaster = new AntBroadcaster(log);
const settings = new SettingsStore();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
    title: 'FitCast',
    show: false,
  });

  // Restrictive CSP
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'",
          ],
        },
      });
    }
  );

  // Block new windows / navigation
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  antBroadcaster.stopAll();
  app.quit();
});

app.on('before-quit', () => {
  antBroadcaster.stopAll();
});

// ─── IPC Handlers ────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  // Parse a .fit file from a given path
  ipcMain.handle('fit:parse', async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath.endsWith('.fit')) {
      throw new Error('Invalid file: must be a .fit file');
    }
    // Validate path exists
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    log.info(`Parsing .fit file: ${filePath}`);
    const buffer = await readFile(filePath);
    currentRideData = await parseFitFile(Buffer.from(buffer));
    log.info(
      `Parsed ${currentRideData.sampleCount} samples, duration: ${currentRideData.totalElapsedSeconds}s`
    );
    return currentRideData;
  });

  // Open file dialog
  ipcMain.handle('dialog:openFit', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'FIT Files', extensions: ['fit'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Get settings
  ipcMain.handle('settings:get', (_event, key: string) => {
    return settings.get(key);
  });

  // Set settings
  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    settings.set(key, value);
  });

  // Check ffmpeg availability
  ipcMain.handle('render:checkFfmpeg', async () => {
    return checkFfmpeg();
  });

  // Start render (placeholder — actual implementation requires ffmpeg + canvas pipeline)
  ipcMain.handle(
    'render:start',
    async (
      _event,
      options: {
        outputPath: string;
        codec: string;
        width: number;
        height: number;
        fps: number;
        startOffset: number;
        duration: number;
      }
    ) => {
      if (!currentRideData) throw new Error('No ride data loaded');
      // Validate output path
      if (typeof options.outputPath !== 'string' || options.outputPath.length === 0) {
        throw new Error('Invalid output path');
      }
      log.info('Render requested with options:', options);
      // TODO: Implement actual render pipeline with headless Chromium + ffmpeg
      // For now, return a stub indicating the pipeline location
      return { status: 'not-implemented', message: 'Render pipeline is stubbed — see CLAUDE.md' };
    }
  );

  ipcMain.handle('render:cancel', async () => {
    log.info('Render cancel requested');
    // TODO: Kill child ffmpeg process
  });

  // Choose output directory
  ipcMain.handle('dialog:chooseOutputDir', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // ─── ANT+ Broadcasting ────────────────────────────────────────────

  ipcMain.handle('ant:startBroadcast', async () => {
    if (!currentRideData) throw new Error('No ride data loaded');
    return antBroadcaster.startBroadcasting(currentRideData);
  });

  ipcMain.handle('ant:stopBroadcast', async () => {
    return antBroadcaster.stopBroadcasting();
  });

  ipcMain.handle('ant:startPlayback', async (_event, options: { startOffset: number }) => {
    if (!currentRideData) throw new Error('No ride data loaded');
    return antBroadcaster.startPlayback(options.startOffset);
  });

  ipcMain.handle('ant:stopPlayback', async () => {
    return antBroadcaster.stopPlayback();
  });

  ipcMain.handle('ant:getStatus', async () => {
    return antBroadcaster.getStatus();
  });

  ipcMain.handle('ant:getDeviceIds', async () => {
    return settings.get('antDeviceIds') ?? {
      power: 12345,
      heartRate: 12346,
      cadence: 12347,
    };
  });

  ipcMain.handle('ant:setDeviceIds', async (_event, ids: Record<string, number>) => {
    settings.set('antDeviceIds', ids);
  });
}
