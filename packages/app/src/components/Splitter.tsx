import { useCallback, useEffect, useRef, type ReactNode } from 'react';

export interface SplitterProps {
  /** Fraction 0..1 of the available width given to `left`. */
  ratio: number;
  onRatioChange(r: number): void;
  left: ReactNode;
  right: ReactNode;
  /** Minimum pixel width enforced on the left pane. Default 240px. */
  minLeft?: number;
  /** Minimum pixel width enforced on the right pane. Default 320px. */
  minRight?: number;
}

const SNAP_POINTS: readonly number[] = [0.25, 0.4, 0.5, 0.6];
const SNAP_THRESHOLD = 0.02;

function snap(value: number): number {
  for (const pt of SNAP_POINTS) {
    if (Math.abs(value - pt) < SNAP_THRESHOLD) return pt;
  }
  return value;
}

/**
 * Horizontal two-pane splitter with mouse drag. No canvas/terminal content
 * renders here — children are whatever panels the caller passes in.
 */
export function Splitter({
  ratio,
  onRatioChange,
  left,
  right,
  minLeft = 240,
  minRight = 320,
}: SplitterProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const applyRatio = useCallback(
    (clientX: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const raw = (clientX - rect.left) / rect.width;
      if (!Number.isFinite(raw)) return;
      const maxByRight = 1 - minRight / rect.width;
      const minByLeft = minLeft / rect.width;
      const clamped = Math.max(minByLeft, Math.min(maxByRight, raw));
      onRatioChange(snap(clamped));
    },
    [minLeft, minRight, onRatioChange],
  );

  useEffect(() => {
    const move = (ev: MouseEvent): void => {
      if (!draggingRef.current) return;
      applyRatio(ev.clientX);
    };
    const up = (): void => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [applyRatio]);

  const onGutterMouseDown = (ev: React.MouseEvent): void => {
    ev.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const leftPct = Math.round(ratio * 10000) / 100;

  return (
    <div
      ref={containerRef}
      data-testid="dc-splitter"
      className="flex flex-1 min-h-0 w-full overflow-hidden"
    >
      <div
        className="min-h-0 h-full overflow-hidden"
        style={{ width: `${leftPct}%` }}
      >
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={leftPct}
        aria-valuemin={0}
        aria-valuemax={100}
        onMouseDown={onGutterMouseDown}
        className="w-1 shrink-0 cursor-col-resize bg-dc-border-hairline transition-colors hover:bg-dc-bg-active"
      />
      <div className="min-h-0 h-full flex-1 overflow-hidden">{right}</div>
    </div>
  );
}
