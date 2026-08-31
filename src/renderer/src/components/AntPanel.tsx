import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { RideData } from '../../../shared/ride-data';
import { formatDuration } from '../../../shared/ride-data';

interface Props {
  rideData: RideData;
  setStatus: (status: { message: string; type: 'info' | 'success' | 'warning' | 'error' }) => void;
}

type AntState = 'idle' | 'broadcasting' | 'playing';

export function AntPanel({ rideData, setStatus }: Props): React.ReactElement {
  const [antState, setAntState] = useState<AntState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [power, setPower] = useState(0);
  const [cadence, setCadence] = useState(0);
  const [hr, setHr] = useState(0);
  const [startOffset, setStartOffset] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll ANT+ status when broadcasting or playing
  useEffect(() => {
    if (antState === 'idle') {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const status = await window.fitcast.getAntStatus();
        setElapsed(status.elapsedSeconds);
        setPower(status.lastPower);
        setCadence(status.lastCadence);
        setHr(status.lastHeartRate);
        if (status.status === 'idle') {
          setAntState('idle');
        } else if (status.status === 'broadcasting' && antState === 'playing') {
          // Playback ended, returned to broadcasting
          setAntState('broadcasting');
          setStatus({ message: 'Playback ended — still broadcasting', type: 'info' });
        }
      } catch {
        // ignore poll errors
      }
    }, 500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [antState, setStatus]);

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
  }, [setStatus]);

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
  }, [setStatus]);

  const handleStartPlayback = useCallback(async () => {
    try {
      await window.fitcast.startPlayback({ startOffset });
      setAntState('playing');
      setStatus({ message: 'Playback started — ride data broadcasting', type: 'success' });
    } catch (err) {
      setStatus({
        message: err instanceof Error ? err.message : 'Failed to start playback',
        type: 'error',
      });
    }
  }, [startOffset, setStatus]);

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
  }, [setStatus]);

  return (
    <div className="card">
      <h2>📡 ANT+ Broadcast</h2>

      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
        Mode: <strong>Simulated</strong> (no USB dongle required)
      </div>

      {(antState === 'broadcasting' || antState === 'playing') && (
        <div className="live-readout">
          <div className="readout-item">
            <span className="readout-value">{power}</span>
            <span className="readout-unit">watts</span>
          </div>
          <div className="readout-item">
            <span className="readout-value">{cadence}</span>
            <span className="readout-unit">rpm</span>
          </div>
          <div className="readout-item">
            <span className="readout-value">{hr}</span>
            <span className="readout-unit">bpm</span>
          </div>
          {antState === 'playing' && (
            <div className="readout-item">
              <span className="readout-value">{formatDuration(elapsed)}</span>
              <span className="readout-unit">elapsed</span>
            </div>
          )}
        </div>
      )}

      <div className="form-group">
        <label>Start Offset (s)</label>
        <input
          type="number"
          value={startOffset}
          onChange={(e) => setStartOffset(Number(e.target.value))}
          min={0}
          max={rideData.totalElapsedSeconds}
          disabled={antState === 'playing'}
        />
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
