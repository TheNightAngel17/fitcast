import React, { useState, useCallback } from 'react';
import type { RideData } from '../../../shared/ride-data';
import { formatDuration } from '../../../shared/ride-data';

interface Props {
  rideData: RideData;
  setStatus: (status: { message: string; type: 'info' | 'success' | 'warning' | 'error' }) => void;
}

export function RenderPanel({ rideData, setStatus }: Props): React.ReactElement {
  const [codec, setCodec] = useState('prores');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(30);
  const [startOffset, setStartOffset] = useState(0);
  const [duration, setDuration] = useState(Math.round(rideData.totalElapsedSeconds));
  const [outputDir, setOutputDir] = useState('');
  const [rendering, setRendering] = useState(false);

  const handleChooseDir = useCallback(async () => {
    const dir = await window.fitcast.chooseOutputDir();
    if (dir) setOutputDir(dir);
  }, []);

  const handleRender = useCallback(async () => {
    if (!outputDir) {
      setStatus({ message: 'Please choose an output directory first', type: 'warning' });
      return;
    }

    // Check ffmpeg
    const ffmpegStatus = await window.fitcast.checkFfmpeg();
    if (!ffmpegStatus.available) {
      setStatus({
        message: ffmpegStatus.error ?? 'ffmpeg not found',
        type: 'error',
      });
      return;
    }

    setRendering(true);
    setStatus({ message: 'Starting render...', type: 'info' });

    try {
      const ext = codec === 'prores' ? 'mov' : 'webm';
      const result = await window.fitcast.startRender({
        outputPath: `${outputDir}/fitcast_overlay.${ext}`,
        codec,
        width,
        height,
        fps,
        startOffset,
        duration,
      });
      setStatus({
        message: result.message ?? 'Render complete',
        type: result.status === 'not-implemented' ? 'warning' : 'success',
      });
    } catch (err) {
      setStatus({
        message: err instanceof Error ? err.message : 'Render failed',
        type: 'error',
      });
    } finally {
      setRendering(false);
    }
  }, [outputDir, codec, width, height, fps, startOffset, duration, setStatus]);

  return (
    <div className="card">
      <h2>🎬 Render Overlay</h2>

      <div className="form-group">
        <label>Codec</label>
        <select value={codec} onChange={(e) => setCodec(e.target.value)}>
          <option value="prores">ProRes 4444 (.mov)</option>
          <option value="vp9">VP9 + Alpha (.webm)</option>
        </select>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <div className="form-group" style={{ flex: 1 }}>
          <label>Width</label>
          <input type="number" value={width} onChange={(e) => setWidth(Number(e.target.value))} />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label>Height</label>
          <input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value))} />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label>FPS</label>
          <input type="number" value={fps} onChange={(e) => setFps(Number(e.target.value))} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <div className="form-group" style={{ flex: 1 }}>
          <label>Start Offset (s)</label>
          <input type="number" value={startOffset} onChange={(e) => setStartOffset(Number(e.target.value))} min={0} max={rideData.totalElapsedSeconds} />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label>Duration (s)</label>
          <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} min={1} />
        </div>
      </div>

      <div className="form-group">
        <label>Output: {outputDir || '(not set)'} · {formatDuration(duration)} of ride</label>
      </div>

      <div className="button-group">
        <button className="btn-secondary" onClick={handleChooseDir}>
          Choose Output Folder
        </button>
        <button className="btn-primary" onClick={handleRender} disabled={rendering || !outputDir}>
          {rendering ? 'Rendering...' : 'Render'}
        </button>
      </div>
    </div>
  );
}
