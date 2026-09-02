import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { RideData } from '../../../../shared/ride-data';
import { formatDuration, formatTimeOfDay } from '../../../../shared/ride-data';
import type { RangeSelection } from '../../../../shared/timeline';
import { OverviewTrack } from './OverviewTrack';
import { DetailChart, type TimeMode } from './DetailChart';
import { useElementWidth } from './useElementWidth';
import '../../styles/timeline.css';

interface Props {
  rideData: RideData;
  selection: RangeSelection;
  onSelectionChange: (sel: RangeSelection) => void;
  playheadSeconds: number | null;
}

// Shared gutters so the overview's plot area lines up with the detail chart's.
const PAD_LEFT = 48; // power axis labels
const PAD_RIGHT = 40; // heart rate axis labels
const OVERVIEW_HEIGHT = 72;
const DETAIL_HEIGHT = 300;

export function RideTimeline({
  rideData,
  selection,
  onSelectionChange,
  playheadSeconds,
}: Props): React.ReactElement {
  const chartsRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(chartsRef);
  const [ftp, setFtp] = useState(0);
  const [timeMode, setTimeMode] = useState<TimeMode>('elapsed');

  useEffect(() => {
    let cancelled = false;
    window.fitcast
      .getSetting('ftp')
      .then((value) => {
        if (!cancelled && typeof value === 'number' && value > 0) setFtp(value);
      })
      .catch(() => {
        // FTP is optional — the chart falls back to a flat fill without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Typing updates the gradient live; persist once on blur rather than per keystroke.
  const persistFtp = useCallback(() => {
    window.fitcast.setSetting('ftp', ftp).catch(() => {});
  }, [ftp]);

  const resetSelection = useCallback(() => {
    onSelectionChange({ start: 0, end: rideData.totalElapsedSeconds });
  }, [onSelectionChange, rideData.totalElapsedSeconds]);

  const isFullRide =
    selection.start <= 0 && selection.end >= rideData.totalElapsedSeconds;

  // Duration is always shown elapsed — "how long", not a clock reading — even
  // when the endpoints themselves are displayed as time of day.
  const formatPoint = useCallback(
    (t: number) =>
      timeMode === 'clock' ? formatTimeOfDay(rideData.startTimestamp, t) : formatDuration(t),
    [timeMode, rideData.startTimestamp]
  );

  return (
    <div className="card tl-card">
      <div className="tl-header">
        <h2>📈 Timeline</h2>
        <div className="tl-range">
          {formatPoint(selection.start)} → {formatPoint(selection.end)} ·{' '}
          <strong>{formatDuration(selection.end - selection.start)}</strong> selected
        </div>
        <div className="tl-time-toggle" role="group" aria-label="Time display">
          <button
            type="button"
            className={timeMode === 'elapsed' ? 'active' : ''}
            onClick={() => setTimeMode('elapsed')}
          >
            Elapsed Time
          </button>
          <button
            type="button"
            className={timeMode === 'clock' ? 'active' : ''}
            onClick={() => setTimeMode('clock')}
          >
            Time of Day
          </button>
        </div>
        <label className="tl-ftp">
          FTP
          <input
            type="number"
            min={0}
            step={5}
            value={ftp || ''}
            placeholder="—"
            onChange={(e) => setFtp(Number(e.target.value))}
            onBlur={persistFtp}
          />
          W
        </label>
        <button className="btn-secondary tl-reset" onClick={resetSelection} disabled={isFullRide}>
          Full ride
        </button>
      </div>

      <div className="tl-charts" ref={chartsRef}>
        {width > 0 && (
          <>
            <OverviewTrack
              samples={rideData.samples}
              totalSeconds={rideData.totalElapsedSeconds}
              selection={selection}
              onSelectionChange={onSelectionChange}
              playheadSeconds={playheadSeconds}
              width={width}
              height={OVERVIEW_HEIGHT}
              padLeft={PAD_LEFT}
              padRight={PAD_RIGHT}
            />
            <DetailChart
              rideData={rideData}
              selection={selection}
              playheadSeconds={playheadSeconds}
              ftp={ftp}
              timeMode={timeMode}
              width={width}
              height={DETAIL_HEIGHT}
              padLeft={PAD_LEFT}
              padRight={PAD_RIGHT}
            />
          </>
        )}
      </div>

      <div className="tl-legend">
        <span className="tl-legend-item tl-legend-power">Power (W, left)</span>
        {rideData.channels.heartRate && (
          <span className="tl-legend-item tl-legend-hr">Heart rate (bpm, right)</span>
        )}
        <span className="tl-legend-hint">
          Drag the handles or the shaded window above to change the range
        </span>
      </div>
    </div>
  );
}
