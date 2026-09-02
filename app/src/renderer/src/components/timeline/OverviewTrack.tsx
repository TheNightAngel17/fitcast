import React, { useCallback, useMemo, useRef } from 'react';
import type { RideSample } from '../../../../shared/ride-data';
import type { RangeSelection } from '../../../../shared/timeline';
import {
  decimateChannel,
  channelExtent,
  clampSelection,
  niceCeiling,
  MIN_SELECTION_SECONDS,
} from '../../../../shared/timeline';
import { areaPath } from './paths';

interface Props {
  samples: RideSample[];
  totalSeconds: number;
  selection: RangeSelection;
  onSelectionChange: (sel: RangeSelection) => void;
  playheadSeconds: number | null;
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
}

/**
 * Dragging one edge always keeps the opposite edge frozen, so crossing over is
 * handled for free by clampSelection's swap. `window` drags the whole range.
 */
type Drag =
  | { mode: 'edge'; fixed: number }
  | { mode: 'window'; grabOffset: number; duration: number };

const HANDLE_WIDTH = 14;
/** Pointer travel before an empty-track press counts as a new selection rather than a stray click. */
const DRAG_THRESHOLD_PX = 2;

export function OverviewTrack({
  samples,
  totalSeconds,
  selection,
  onSelectionChange,
  playheadSeconds,
  width,
  height,
  padLeft,
  padRight,
}: Props): React.ReactElement {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const downXRef = useRef(0);
  const movedRef = useRef(false);

  const plotWidth = Math.max(1, width - padLeft - padRight);
  const plotTop = 6;
  const plotBottom = height - 6;
  const plotHeight = plotBottom - plotTop;

  const xOf = useCallback(
    (t: number) => padLeft + (t / totalSeconds) * plotWidth,
    [padLeft, totalSeconds, plotWidth]
  );

  /** Inverse of xOf: client pixel position -> elapsed seconds. */
  const tOf = useCallback(
    (clientX: number): number => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      const x = clientX - rect.left - padLeft;
      return Math.min(Math.max((x / plotWidth) * totalSeconds, 0), totalSeconds);
    },
    [padLeft, plotWidth, totalSeconds]
  );

  // Independent of the selection, so dragging the brush never recomputes it.
  const buckets = useMemo(
    () => decimateChannel(samples, 'power', 0, totalSeconds, Math.round(plotWidth)),
    [samples, totalSeconds, plotWidth]
  );

  const yMax = useMemo(() => {
    const extent = channelExtent(samples, 'power', 0, totalSeconds);
    return niceCeiling(extent?.max ?? 1);
  }, [samples, totalSeconds]);

  const yOf = useCallback(
    (v: number) => plotBottom - (v / yMax) * plotHeight,
    [plotBottom, plotHeight, yMax]
  );

  const area = useMemo(
    () => areaPath(buckets, (b) => b.avg, xOf, yOf, plotBottom),
    [buckets, xOf, yOf, plotBottom]
  );

  const commit = useCallback(
    (sel: RangeSelection) => onSelectionChange(clampSelection(sel, totalSeconds)),
    [onSelectionChange, totalSeconds]
  );

  const beginDrag = useCallback(
    (e: React.PointerEvent, drag: Drag) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = drag;
      downXRef.current = e.clientX;
      movedRef.current = false;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!movedRef.current && Math.abs(e.clientX - downXRef.current) < DRAG_THRESHOLD_PX) return;
      movedRef.current = true;

      const t = tOf(e.clientX);
      if (drag.mode === 'edge') {
        commit({ start: drag.fixed, end: t });
      } else {
        const start = Math.min(Math.max(t - drag.grabOffset, 0), totalSeconds - drag.duration);
        commit({ start, end: start + drag.duration });
      }
    },
    [commit, tOf, totalSeconds]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    const target = e.currentTarget as Element;
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
  }, []);

  /** Arrow keys nudge an edge; Home/End snap it to the ride bounds. */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, edge: 'start' | 'end') => {
      const step = e.shiftKey ? 10 : 1;
      const fixed = edge === 'start' ? selection.end : selection.start;
      const current = edge === 'start' ? selection.start : selection.end;
      let next: number;

      switch (e.key) {
        case 'ArrowLeft':
          next = current - step;
          break;
        case 'ArrowRight':
          next = current + step;
          break;
        case 'Home':
          next = edge === 'start' ? 0 : selection.start + MIN_SELECTION_SECONDS;
          break;
        case 'End':
          next = edge === 'start' ? selection.end - MIN_SELECTION_SECONDS : totalSeconds;
          break;
        default:
          return;
      }

      e.preventDefault();
      commit({ start: fixed, end: next });
    },
    [commit, selection.start, selection.end, totalSeconds]
  );

  const startX = xOf(selection.start);
  const endX = xOf(selection.end);
  const playheadX = playheadSeconds !== null ? xOf(playheadSeconds) : null;

  const handle = (edge: 'start' | 'end', x: number): React.ReactElement => (
    <g
      key={edge}
      className="tl-handle"
      role="slider"
      tabIndex={0}
      aria-label={edge === 'start' ? 'Selection start' : 'Selection end'}
      aria-valuemin={0}
      aria-valuemax={Math.round(totalSeconds)}
      aria-valuenow={Math.round(edge === 'start' ? selection.start : selection.end)}
      onPointerDown={(e) =>
        beginDrag(e, { mode: 'edge', fixed: edge === 'start' ? selection.end : selection.start })
      }
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={(e) => handleKeyDown(e, edge)}
    >
      <rect
        x={x - HANDLE_WIDTH / 2}
        y={plotTop - 3}
        width={HANDLE_WIDTH}
        height={plotHeight + 6}
        rx={6}
        className="tl-handle-body"
      />
      <line x1={x - 2.5} x2={x - 2.5} y1={plotTop + 5} y2={plotBottom - 5} className="tl-handle-grip" />
      <line x1={x + 2.5} x2={x + 2.5} y1={plotTop + 5} y2={plotBottom - 5} className="tl-handle-grip" />
    </g>
  );

  return (
    <svg
      ref={svgRef}
      className="tl-overview"
      width={width}
      height={height}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Press on empty track starts a fresh selection, but only once dragged. */}
      <rect
        x={padLeft}
        y={plotTop}
        width={plotWidth}
        height={plotHeight}
        className="tl-overview-bg"
        onPointerDown={(e) => beginDrag(e, { mode: 'edge', fixed: tOf(e.clientX) })}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      <path d={area} className="tl-overview-area" />

      {/* Dim everything outside the selection */}
      <rect x={padLeft} y={plotTop} width={Math.max(0, startX - padLeft)} height={plotHeight} className="tl-dim" />
      <rect x={endX} y={plotTop} width={Math.max(0, padLeft + plotWidth - endX)} height={plotHeight} className="tl-dim" />

      {/* Drag the window itself to pan without changing its duration */}
      <rect
        x={startX}
        y={plotTop}
        width={Math.max(0, endX - startX)}
        height={plotHeight}
        className="tl-window"
        onPointerDown={(e) =>
          beginDrag(e, {
            mode: 'window',
            grabOffset: tOf(e.clientX) - selection.start,
            duration: selection.end - selection.start,
          })
        }
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      {playheadX !== null && (
        <line x1={playheadX} x2={playheadX} y1={plotTop} y2={plotBottom} className="tl-playhead" />
      )}

      {handle('start', startX)}
      {handle('end', endX)}
    </svg>
  );
}
