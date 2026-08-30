import React, { useState, useCallback } from 'react';
import type { RideData } from '../../shared/ride-data';
import { FileDropZone } from './components/FileDropZone';
import { RideSummaryPanel } from './components/RideSummaryPanel';
import { RenderPanel } from './components/RenderPanel';
import { AntPanel } from './components/AntPanel';
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

  const handleFileSelect = useCallback(async (filePath: string) => {
    setLoading(true);
    setStatus({ message: 'Parsing .fit file...', type: 'info' });
    try {
      const data = await window.fitcast.parseFitFile(filePath);
      setRideData(data);
      setStatus({
        message: `Loaded: ${data.sampleCount} samples, ${Math.round(data.totalElapsedSeconds / 60)}min ride`,
        type: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse file';
      setStatus({ message: msg, type: 'error' });
      setRideData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>FitCast</h1>
        <span className="app-subtitle">Ride Overlay & ANT+ Playback</span>
      </header>

      <main className="app-main">
        <FileDropZone onFileSelect={handleFileSelect} loading={loading} />

        {rideData && (
          <>
            <RideSummaryPanel rideData={rideData} />

            <div className="panels-row">
              <RenderPanel rideData={rideData} setStatus={setStatus} />
              <AntPanel rideData={rideData} setStatus={setStatus} />
            </div>
          </>
        )}
      </main>

      <StatusBar message={status.message} type={status.type} />
    </div>
  );
}
