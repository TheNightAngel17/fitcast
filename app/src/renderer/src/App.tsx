import React, { useState, useCallback, useEffect } from 'react';
import type { RideData } from '../../shared/ride-data';
import type { RangeSelection } from '../../shared/timeline';
import { clampSelection } from '../../shared/timeline';
import { FileDropZone } from './components/FileDropZone';
import { RideSummaryPanel } from './components/RideSummaryPanel';
import { RideTimeline } from './components/timeline/RideTimeline';
import { RenderPanel } from './components/RenderPanel';
import { AntPanel } from './components/AntPanel';
import type { AntState, AntStatusSnapshot } from './components/AntPanel';
import { StatusBar } from './components/StatusBar';
import './styles/app.css';

type AppStatus = {
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
};

export default function App(): React.ReactElement {
  const [rideData, setRideData] = useState<RideData | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<AppStatus>({
    message: 'Drop a .fit file to get started',
    type: 'info',
  });

  // The timeline selection is the single source of truth for the range that
  // both the render and playback pipelines operate on.
  const [selection, setSelection] = useState<RangeSelection | null>(null);

  // ANT+ state lives here rather than in AntPanel so the timeline can draw a
  // playhead from the same poll that drives the panel's live readout.
  const [antState, setAntState] = useState<AntState>('idle');
  const [antStatus, setAntStatus] = useState<AntStatusSnapshot | null>(null);

  const handleFileSelect = useCallback(async (filePath: string) => {
    setLoading(true);
    setStatus({ message: 'Parsing .fit file...', type: 'info' });
    try {
      const data = await window.fitcast.parseFitFile(filePath);
      setRideData(data);
      setSelection({ start: 0, end: data.totalElapsedSeconds });
      setStatus({
        message: `Loaded: ${data.sampleCount} samples, ${Math.round(data.totalElapsedSeconds / 60)}min ride`,
        type: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse file';
      setStatus({ message: msg, type: 'error' });
      setRideData(null);
      setSelection(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectionChange = useCallback(
    (sel: RangeSelection) => {
      if (!rideData) return;
      setSelection(clampSelection(sel, rideData.totalElapsedSeconds));
    },
    [rideData]
  );

  // Poll ANT+ status when broadcasting or playing
  useEffect(() => {
    if (antState === 'idle') return;

    const timer = setInterval(async () => {
      try {
        const next = await window.fitcast.getAntStatus();
        setAntStatus(next);
        if (next.status === 'idle') {
          setAntState('idle');
        } else if (next.status === 'broadcasting' && antState === 'playing') {
          // Playback ended, returned to broadcasting
          setAntState('broadcasting');
          setStatus({ message: 'Playback ended — still broadcasting', type: 'info' });
        }
      } catch {
        // ignore poll errors
      }
    }, 500);

    return () => clearInterval(timer);
  }, [antState]);

  const playheadSeconds =
    antState === 'playing' && antStatus ? antStatus.elapsedSeconds : null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>FitCast</h1>
        <span className="app-subtitle">Ride Overlay & ANT+ Playback</span>
      </header>

      <main className="app-main">
        <FileDropZone onFileSelect={handleFileSelect} loading={loading} />

        {rideData && selection && (
          <>
            <RideSummaryPanel rideData={rideData} />

            <RideTimeline
              rideData={rideData}
              selection={selection}
              onSelectionChange={handleSelectionChange}
              playheadSeconds={playheadSeconds}
            />

            <div className="panels-row">
              <RenderPanel rideData={rideData} selection={selection} setStatus={setStatus} />
              <AntPanel
                selection={selection}
                antState={antState}
                setAntState={setAntState}
                antStatus={antStatus}
                setStatus={setStatus}
              />
            </div>
          </>
        )}
      </main>

      <StatusBar message={status.message} type={status.type} />
    </div>
  );
}
