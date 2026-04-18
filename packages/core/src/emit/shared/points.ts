// Shared helpers for linear-element point normalisation. Extracted from
// `emit/connector.ts` so Line, Freedraw, Image path-placeholder, and Connector
// all route through the same code path.
// See docs/03-compile-pipeline.md §302-330 and pitfall guard P3.

import type { Point } from '../../primitives.js';
import type { LocalPoint } from '../../types/excalidraw.js';

/**
 * Result of translating a scene-coordinate polyline so that its first point
 * sits at the local origin `[0, 0]` (P3).
 */
export interface NormalizedPoints {
  /** Local-coordinate point list; `points[0]` is always `[0, 0]`. */
  points: LocalPoint[];
  /** Scene-space origin (i.e. the first input point). */
  x: number;
  y: number;
  /** Axis-aligned bounding box of the local points. */
  width: number;
  height: number;
}

/**
 * Translate `points` so that `points[0] === [0, 0]`. The returned `(x, y)`
 * is the first input point — callers assign it to the element's origin so
 * scene coordinates are preserved. Empty input yields a zero box.
 */
export function normalizePoints(points: readonly Point[]): NormalizedPoints {
  if (points.length === 0) {
    return { points: [], x: 0, y: 0, width: 0, height: 0 };
  }
  const first = points[0] as Point;
  const ox = first[0];
  const oy = first[1];
  const locals: LocalPoint[] = points.map(
    ([px, py]) => [px - ox, py - oy] as LocalPoint,
  );
  let minX = locals[0]![0];
  let maxX = minX;
  let minY = locals[0]![1];
  let maxY = minY;
  for (const [x, y] of locals) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    points: locals,
    x: ox,
    y: oy,
    width: maxX - minX,
    height: maxY - minY,
  };
}
