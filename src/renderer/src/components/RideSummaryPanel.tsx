import React from 'react';
import type { RideData } from '../../../shared/ride-data';
import { formatDuration } from '../../../shared/ride-data';

interface Props {
  rideData: RideData;
}

export function RideSummaryPanel({ rideData }: Props): React.ReactElement {
  const { summary, channels, totalElapsedSeconds, movingTimeSeconds, sampleCount } = rideData;
  const startDate = new Date(rideData.startTimestamp);

  return (
    <div className="card">
      <h2>Ride Summary</h2>
      <div className="stats-grid">
        <StatItem label="Date" value={startDate.toLocaleDateString()} />
        <StatItem label="Duration" value={formatDuration(totalElapsedSeconds)} />
        <StatItem label="Moving Time" value={formatDuration(movingTimeSeconds)} />
        <StatItem label="Samples" value={sampleCount.toLocaleString()} />

        {channels.power && (
          <>
            <StatItem label="Avg Power" value={`${Math.round(summary.avgPower ?? 0)}W`} />
            <StatItem label="Max Power" value={`${Math.round(summary.maxPower ?? 0)}W`} />
            {summary.normalizedPower != null && (
              <StatItem label="NP" value={`${Math.round(summary.normalizedPower)}W`} />
            )}
          </>
        )}

        {channels.heartRate && (
          <>
            <StatItem label="Avg HR" value={`${Math.round(summary.avgHeartRate ?? 0)}bpm`} />
            <StatItem label="Max HR" value={`${Math.round(summary.maxHeartRate ?? 0)}bpm`} />
          </>
        )}

        {channels.cadence && (
          <>
            <StatItem label="Avg Cadence" value={`${Math.round(summary.avgCadence ?? 0)}rpm`} />
            <StatItem label="Max Cadence" value={`${Math.round(summary.maxCadence ?? 0)}rpm`} />
          </>
        )}

        {channels.speed && summary.avgSpeed != null && (
          <StatItem label="Avg Speed" value={`${(summary.avgSpeed * 3.6).toFixed(1)} km/h`} />
        )}

        {channels.distance && summary.totalDistance != null && (
          <StatItem label="Distance" value={`${(summary.totalDistance / 1000).toFixed(1)} km`} />
        )}

        {channels.altitude && summary.totalElevationGain != null && (
          <StatItem label="Elevation Gain" value={`${Math.round(summary.totalElevationGain)}m`} />
        )}
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="stat-item">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
