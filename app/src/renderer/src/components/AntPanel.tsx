import React, { useCallback } from 'react';
import { formatDuration } from '../../../shared/ride-data';
import type { RangeSelection } from '../../../shared/timeline';

export type AntState = 'idle' | 'broadcasting' | 'playing';

/** Live broadcaster telemetry, polled by App so the timeline can share it. */
export interface AntStatusSnapshot {
  status: string;
  elapsedSeconds: number;
  error?: string;
  lastPower: number;
  lastCadence: number;
  lastHeartRate: number;
}

interface Props {
  selection: RangeSelection;
  antState: AntState;
  setAntState: (state: AntState) => void;
  antStatus: AntStatusSnapshot | null;
  setStatus: (status: { message: string; type: 'info' | 'success' | 'warning' | 'error' }) => void;
}

export function AntPanel({
  selection,
  antState,
  setAntState,
  antStatus,
  setStatus,
}: Props): React.ReactElement {
  const handleStartBroadcast = useCallback(async () => {
    try {
      await window.fitcast.startBroadcast();
      setAntState('broadcasting');
      setStatus({ message: 'Broadcasting idle ANT+ data — pair your devices now', type: 'success' });
    } catch (err) {
      setStatus({
        message: err instanceof Error ? err.message : 'Failed to start broadcast',
        type: 'error',
      });
    }
  }, [setAntState, setStatus]);

  const handleStopBroadcast = useCallback(async () => {
    try {
      await window.fitcast.stopBroadcast();
      setAntState('idle');
      setStatus({ message: 'Broadcast stopped', type: 'info' });
    } catch (err) {
      setStatus({
        message: err instanceof Error ? err.message : 'Failed to stop broadcast',
        type: 'error',
      });
    }
  }, [setAntState, setStatus]);

  const handleStartPlayback = useCallback(async () => {
    try {
      await window.fitcast.startPlayback({
        startOffset: Math.round(selection.start),
        endOffset: Math.round(selection.end),
      });
      setAntState('playing');
      setStatus({ message: 'Playback started — ride data broadcasting', type: 'success' });
    } catch (err) {
      setStatus({
        message: err instanceof Error ? err.message : 'Failed to start playback',
        type: 'error',
      });
    }
  }, [selection.start, selection.end, setAntState, setStatus]);

  const handleStopPlayback = useCallback(async () => {
    try {
      await window.fitcast.stopPlayback();
      setAntState('broadcasting');
      setStatus({ message: 'Playback stopped — still broadcasting idle', type: 'info' });
    } catch (err) {
      setStatus({
        message: err instanceof Error ? err.message : 'Failed to stop playback',
        type: 'error',
      });
    }
  }, [setAntState, setStatus]);

  const live = antStatus ?? { lastPower: 0, lastCadence: 0, lastHeartRate: 0, elapsedSeconds: 0 };

  return (
    <div className="card">
      <h2>📡 ANT+ Broadcast</h2>

      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
        Mode: <strong>Simulated</strong> (no USB dongle required)
      </div>

      {(antState === 'broadcasting' || antState === 'playing') && (
        <div className="live-readout">
          <div className="readout-item">
            <span className="readout-value">{live.lastPower}</span>
            <span className="readout-unit">watts</span>
          </div>
          <div className="readout-item">
            <span className="readout-value">{live.lastCadence}</span>
            <span className="readout-unit">rpm</span>
          </div>
          <div className="readout-item">
            <span className="readout-value">{live.lastHeartRate}</span>
            <span className="readout-unit">bpm</span>
          </div>
          {antState === 'playing' && (
            <div className="readout-item">
              <span className="readout-value">{formatDuration(live.elapsedSeconds)}</span>
              <span className="readout-unit">elapsed</span>
            </div>
          )}
        </div>
      )}

      <div className="form-group">
        <label>Playback range (set on the timeline)</label>
        <div className="range-readout">
          {formatDuration(selection.start)} → {formatDuration(selection.end)} ·{' '}
          {formatDuration(selection.end - selection.start)}
        </div>
      </div>

      <div className="button-group">
        {antState === 'idle' && (
          <button className="btn-success" onClick={handleStartBroadcast}>
            Start Broadcasting
          </button>
        )}
        {antState === 'broadcasting' && (
          <>
            <button className="btn-primary" onClick={handleStartPlayback}>
              ▶ Playback
            </button>
            <button className="btn-danger" onClick={handleStopBroadcast}>
              Stop Broadcast
            </button>
          </>
        )}
        {antState === 'playing' && (
          <>
            <button className="btn-warning" onClick={handleStopPlayback}>
              ⏹ Stop Playback
            </button>
            <button className="btn-danger" onClick={handleStopBroadcast}>
              Stop All
            </button>
          </>
        )}
      </div>
    </div>
  );
}
