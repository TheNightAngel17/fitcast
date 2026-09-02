import React, { useCallback, useId, useMemo, useState } from 'react';
import type { RideData } from '../../../../shared/ride-data';
import { formatDuration, formatTimeOfDay, sampleAtElapsedSeconds } from '../../../../shared/ride-data';
import type { RangeSelection } from '../../../../shared/timeline';
import {
  decimateChannel,
  channelExtent,
  niceCeiling,
  niceStep,
  zoneColorForValue,
} from '../../../../shared/timeline';
import { zoneGradientRuns, linePath } from './paths';

/** Fill used when FTP isn't set, so the chart still reads without zone colours. */
const FLAT_FILL_COLOR = 'var(--accent)';
/** Width, in pixels, of the smoothed blend at a power-zone crossing. */
const ZONE_TRANSITION_PX = 8;

export type TimeMode = 'elapsed' | 'clock';

interface Props {
  rideData: RideData;
  selection: RangeSelection;
  playheadSeconds: number | null;
  ftp: number;
  timeMode: TimeMode;
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
}

const PAD_TOP = 12;
const PAD_BOTTOM = 26;
const HR_COLOR = '#c62828';

/** Evenly spaced tick values on a nice step, covering [lo, hi]. */
function ticksOver(lo: number, hi: number, targetTicks: number): number[] {
  const step = niceStep(hi - lo, targetTicks);
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-6; t += step) {
    out.push(t);
  }
  return out;
}

export function DetailChart({
  rideData,
  selection,
  playheadSeconds,
  ftp,
  timeMode,
  width,
  height,
  padLeft,
  padRight,
}: Props): React.ReactElement {
  // Gradient ids embed colons from useId(), which break `url(#...)` references.
  const gradientBaseId = `tl-power-${useId().replace(/:/g, '')}`;
  const [hoverT, setHoverT] = useState<number | null>(null);

  const { samples, channels } = rideData;
  const { start, end } = selection;
  const span = Math.max(end - start, 1);

  const plotWidth = Math.max(1, width - padLeft - padRight);
  const plotBottom = height - PAD_BOTTOM;
  const plotHeight = Math.max(1, plotBottom - PAD_TOP);
  const columns = Math.round(plotWidth);

  const xOf = useCallback(
    (t: number) => padLeft + ((t - start) / span) * plotWidth,
    [padLeft, plotWidth, span, start]
  );

  const powerBuckets = useMemo(
    () => decimateChannel(samples, 'power', start, end, columns),
    [samples, start, end, columns]
  );
  const hrBuckets = useMemo(
    () => decimateChannel(samples, 'heartRate', start, end, columns),
    [samples, start, end, columns]
  );

  // Both axes rescale to whatever is inside the selection.
  const powerMax = useMemo(() => {
    const extent = channelExtent(samples, 'power', start, end);
    return niceCeiling(extent?.max ?? 1);
  }, [samples, start, end]);

  const hrMax = useMemo(() => {
    const extent = channelExtent(samples, 'heartRate', start, end);
    return extent ? niceCeiling(extent.max) : null;
  }, [samples, start, end]);

  const yPower = useCallback(
    (v: number) => plotBottom - (v / powerMax) * plotHeight,
    [plotBottom, plotHeight, powerMax]
  );
  const yHr = useCallback(
    (v: number) => plotBottom - (v / (hrMax ?? 1)) * plotHeight,
    [plotBottom, plotHeight, hrMax]
  );

  // Each point is coloured by its own value, not by a shared vertical gradient —
  // a column that peaks in Zone 4 is solid Zone 4 for its whole height.
  const colorOf = useCallback(
    (v: number) => (ftp > 0 ? zoneColorForValue(v, ftp) : FLAT_FILL_COLOR),
    [ftp]
  );
  const zoneGradients = useMemo(
    () => zoneGradientRuns(powerBuckets, (b) => b.max, xOf, yPower, plotBottom, colorOf, ZONE_TRANSITION_PX),
    [powerBuckets, xOf, yPower, plotBottom, colorOf]
  );
  const powerLine = useMemo(
    () => linePath(powerBuckets, (b) => b.max, xOf, yPower),
    [powerBuckets, xOf, yPower]
  );
  const hrLine = useMemo(
    () => linePath(hrBuckets, (b) => b.avg, xOf, yHr),
    [hrBuckets, xOf, yHr]
  );

  const powerTicks = useMemo(() => ticksOver(0, powerMax, 5), [powerMax]);
  const hrTicks = useMemo(() => (hrMax ? ticksOver(0, hrMax, 5) : []), [hrMax]);
  const timeTicks = useMemo(() => ticksOver(start, end, 6), [start, end]);

  const formatTime = useCallback(
    (t: number) =>
      timeMode === 'clock' ? formatTimeOfDay(rideData.startTimestamp, t) : formatDuration(t),
    [timeMode, rideData.startTimestamp]
  );

  const showThreshold = ftp > 0 && ftp <= powerMax;
  const playheadX =
    playheadSeconds !== null && playheadSeconds >= start && playheadSeconds <= end
      ? xOf(playheadSeconds)
      : null;

  const handleHover = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / rect.width;
      setHoverT(start + Math.min(Math.max(frac, 0), 1) * span);
    },
    [span, start]
  );

  const hovered = hoverT === null ? null : sampleAtElapsedSeconds(rideData, hoverT);
  const hoverX = hoverT === null ? 0 : xOf(hoverT);
  // Flip the tooltip to the left of the cursor when it would overflow the chart.
  const tooltipFlipped = hoverX > padLeft + plotWidth * 0.7;

  return (
    <div className="tl-detail-wrap">
      <svg className="tl-detail" width={width} height={height}>
        <defs>
          {zoneGradients.map((g, i) => (
            <linearGradient
              key={i}
              id={`${gradientBaseId}-${i}`}
              gradientUnits="userSpaceOnUse"
              x1={g.x1}
              x2={g.x2}
              y1={0}
              y2={0}
            >
              {g.stops.map((s, si) => (
                <stop key={si} offset={s.offset} stopColor={s.color} />
              ))}
            </linearGradient>
          ))}
        </defs>

        {/* Power gridlines + left axis */}
        {powerTicks.map((v) => (
          <g key={`p${v}`}>
            <line x1={padLeft} x2={padLeft + plotWidth} y1={yPower(v)} y2={yPower(v)} className="tl-grid" />
            <text x={padLeft - 8} y={yPower(v)} className="tl-axis-label tl-axis-left">
              {Math.round(v)}
            </text>
          </g>
        ))}

        {/* Heart rate right axis */}
        {hrTicks.map((v) => (
          <text key={`h${v}`} x={padLeft + plotWidth + 8} y={yHr(v)} className="tl-axis-label tl-axis-right">
            {Math.round(v)}
          </text>
        ))}

        {/* Time axis */}
        {timeTicks.map((t) => (
          <text key={`t${t}`} x={xOf(t)} y={plotBottom + 16} className="tl-axis-label tl-axis-time">
            {formatTime(t)}
          </text>
        ))}

        {zoneGradients.map((g, i) => (
          <path key={i} d={g.d} fill={`url(#${gradientBaseId}-${i})`} fillOpacity={0.9} />
        ))}
        <path d={powerLine} className="tl-power-line" />

        {showThreshold && (
          <g className="tl-threshold">
            <line x1={padLeft} x2={padLeft + plotWidth} y1={yPower(ftp)} y2={yPower(ftp)} />
            <text x={padLeft + 6} y={yPower(ftp) - 4}>
              Threshold Power
            </text>
          </g>
        )}

        {channels.heartRate && <path d={hrLine} className="tl-hr-line" stroke={HR_COLOR} />}

        {playheadX !== null && (
          <line x1={playheadX} x2={playheadX} y1={PAD_TOP} y2={plotBottom} className="tl-playhead" />
        )}

        {hoverT !== null && hovered && (
          <g className="tl-crosshair">
            <line x1={hoverX} x2={hoverX} y1={PAD_TOP} y2={plotBottom} />
            {hovered.power !== null && <circle cx={hoverX} cy={yPower(hovered.power)} r={3.5} className="tl-dot-power" />}
            {hovered.heartRate !== null && hrMax !== null && (
              <circle cx={hoverX} cy={yHr(hovered.heartRate)} r={3.5} fill={HR_COLOR} />
            )}
          </g>
        )}

        <rect
          x={padLeft}
          y={PAD_TOP}
          width={plotWidth}
          height={plotHeight}
          className="tl-hover-target"
          onPointerMove={handleHover}
          onPointerLeave={() => setHoverT(null)}
        />
      </svg>

      {hoverT !== null && hovered && (
        <div
          className="tl-tooltip"
          style={{
            left: tooltipFlipped ? undefined : hoverX + 12,
            right: tooltipFlipped ? width - hoverX + 12 : undefined,
          }}
        >
          <div className="tl-tooltip-time">{formatTime(hoverT)}</div>
          {hovered.power !== null && (
            <div>
              <span className="tl-tooltip-key">Power</span> {Math.round(hovered.power)} W
            </div>
          )}
          {hovered.heartRate !== null && (
            <div>
              <span className="tl-tooltip-key">HR</span> {Math.round(hovered.heartRate)} bpm
            </div>
          )}
          {hovered.cadence !== null && (
            <div>
              <span className="tl-tooltip-key">Cadence</span> {Math.round(hovered.cadence)} rpm
            </div>
          )}
        </div>
      )}
    </div>
  );
}
