/**
 * ffmpeg availability check.
 * Detects whether ffmpeg is on PATH and returns version info.
 */

import { spawn } from 'child_process';

export interface FfmpegStatus {
  available: boolean;
  version?: string;
  error?: string;
}

export function checkFfmpeg(): Promise<FfmpegStatus> {
  return new Promise((resolve) => {
    try {
      const proc = spawn('ffmpeg', ['-version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let output = '';
      proc.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.on('error', () => {
        resolve({
          available: false,
          error:
            'ffmpeg not found on PATH. Please install ffmpeg and ensure it is accessible from the command line. Download from https://ffmpeg.org/download.html',
        });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          const versionMatch = output.match(/ffmpeg version (\S+)/);
          resolve({
            available: true,
            version: versionMatch?.[1] ?? 'unknown',
          });
        } else {
          resolve({
            available: false,
            error: `ffmpeg exited with code ${code}`,
          });
        }
      });
    } catch {
      resolve({
        available: false,
        error: 'Failed to check ffmpeg availability',
      });
    }
  });
}
