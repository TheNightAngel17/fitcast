import React, { useState, useCallback, useMemo } from 'react';
import type { RideData } from '../../../shared/ride-data';
import { formatDuration } from '../../../shared/ride-data';
import type { RangeSelection } from '../../../shared/timeline';
import {
  RENDER_FORMATS,
  FRAME_RATE_PRESETS,
  DEFAULT_RENDER_FORMAT_ID,
  DEFAULT_FRAME_RATE_ID,
  resolveRenderFormat,
  resolveFrameRate,
  validateDimensions,
  resolveOutputTarget,
  frameCount,
} from '../../../shared/render-formats';

interface Props {
  rideData: RideData;
  selection: RangeSelection;
  setStatus: (status: { message: string; type: 'info' | 'success' | 'warning' | 'error' }) => void;
}

export function RenderPanel({ rideData, selection, setStatus }: Props): React.ReactElement {
  const [formatId, setFormatId] = useState<string>(DEFAULT_RENDER_FORMAT_ID);
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [frameRateId, setFrameRateId] = useState<string>(DEFAULT_FRAME_RATE_ID);
  const [outputDir, setOutputDir] = useState('');
  const [rendering, setRendering] = useState(false);

  const startOffset = Math.round(selection.start);
  const duration = Math.round(selection.end - selection.start);

  const format = useMemo(() => resolveRenderFormat(formatId), [formatId]);
  const frameRate = useMemo(() => resolveFrameRate(frameRateId), [frameRateId]);
  const dimensionError = validateDimensions(width, height, format);
  const totalFrames = frameCount(duration, frameRate);

  const handleChooseDir = useCallback(async () => {
    const dir = await window.fitcast.chooseOutputDir();
    if (dir) setOutputDir(dir);
  }, []);

  const handleRender = useCallback(async () => {
    if (!outputDir) {
      setStatus({ message: 'Please choose an output directory first', type: 'warning' });
      return;
    }

    if (dimensionError) {
      setStatus({ message: dimensionError, type: 'warning' });
      return;
    }

    // A PNG sequence is written straight from the frame capture, so it renders
    // fine on a machine with no ffmpeg. Only gate the formats that encode.
    if (format.requiresFfmpeg) {
      const ffmpegStatus = await window.fitcast.checkFfmpeg();
      if (!ffmpegStatus.available) {
        setStatus({
          message: ffmpegStatus.error ?? 'ffmpeg not found',
          type: 'error',
        });
        return;
      }
    }

    setRendering(true);
    setStatus({ message: 'Starting render...', type: 'info' });

    try {
      const target = resolveOutputTarget(outputDir, format);
      const result = await window.fitcast.startRender({
        outputPath: target.path,
        format: format.id,
        width,
        height,
        frameRate: { num: frameRate.num, den: frameRate.den },
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
  }, [outputDir, format, frameRate, dimensionError, width, height, startOffset, duration, setStatus]);

  return (
    <div className="card">
      <h2>🎬 Render Overlay</h2>

      <div className="form-group">
        <label>Format</label>
        <select value={formatId} onChange={(e) => setFormatId(e.target.value)}>
          {RENDER_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <small>
          {format.isSequence
            ? `Numbered frames in a folder — no encoding, so transparency is exact. ${totalFrames.toLocaleString()} files.`
            : 'Premiere reads the alpha channel automatically. One file.'}
        </small>
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
          <label>Frame rate</label>
          <select value={frameRateId} onChange={(e) => setFrameRateId(e.target.value)}>
            {FRAME_RATE_PRESETS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {dimensionError && <div className="form-error">{dimensionError}</div>}

      <p className="form-hint">
        Match your footage exactly. Cameras that show &ldquo;30&rdquo; almost always record
        29.97 — over an hour the two drift 3.6 seconds apart. Render the overlay at or above
        the size you&rsquo;ll place it at; scaling it down in Premiere is free, scaling up
        softens the edges.
      </p>

      <div className="form-group">
        <label>Render range (set on the timeline)</label>
        <div className="range-readout">
          {formatDuration(selection.start)} → {formatDuration(selection.end)} ·{' '}
          {formatDuration(duration)} of {formatDuration(rideData.totalElapsedSeconds)}
        </div>
      </div>

      <div className="form-group">
        <label>
          Output: {outputDir ? resolveOutputTarget(outputDir, format).path : '(not set)'}
        </label>
      </div>

      <div className="button-group">
        <button className="btn-secondary" onClick={handleChooseDir}>
          Choose Output Folder
        </button>
        <button
          className="btn-primary"
          onClick={handleRender}
          disabled={rendering || !outputDir || dimensionError !== null}
        >
          {rendering ? 'Rendering...' : 'Render'}
        </button>
      </div>
    </div>
  );
}
