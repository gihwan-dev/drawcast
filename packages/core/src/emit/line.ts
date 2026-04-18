// Emitter for the Line primitive: a single `line` element (polyline, no
// arrowheads). See docs/02-l2-primitives.md §281-310 and
// docs/03-compile-pipeline.md §292-310.
//
// Pitfall guards:
//   P3  — points[0] normalised to [0,0]; (x,y) captures the scene origin.
//   P13 — we don't enforce minimum length here; callers can pass any number
//         of points and the element still renders (a single point collapses
//         to a zero-size box).

import type { Line, Point, Radians } from '../primitives.js';
import { degreesToRadians } from '../utils/angle.js';
import { baseElementFields } from '../utils/baseElementFields.js';
import { newElementId } from '../utils/id.js';
import type { ExcalidrawLineElement } from '../types/excalidraw.js';
import type { CompileContext } from '../compile/context.js';
import { resolveEdgeStyle } from '../compile/resolveStyle.js';
import { normalizePoints } from './shared/points.js';

export function emitLine(p: Line, ctx: CompileContext): void {
  // Line shares edge-preset semantics with Connector (stroke-driven style).
  const style = resolveEdgeStyle(p.style, ctx.theme, p.id, ctx);

  // p.at is the explicit scene origin; p.points are local offsets to be
  // translated into scene space before normalisation.
  const scenePoints: Point[] = p.points.map(
    ([dx, dy]) => [p.at[0] + dx, p.at[1] + dy] as Point,
  );
  const normalized = normalizePoints(scenePoints);

  // If the caller requested a polygon, enforce first==last as a cheap safety
  // net — docs/02 says the compiler auto-corrects rather than erroring.
  let points = normalized.points;
  if (p.polygon && points.length >= 2) {
    const firstLocal = points[0]!;
    const lastLocal = points[points.length - 1]!;
    if (firstLocal[0] !== lastLocal[0] || firstLocal[1] !== lastLocal[1]) {
      points = [...points, [firstLocal[0], firstLocal[1]] as const];
    }
  }

  const id = newElementId();
  const dashed = p.dashed === true;
  const strokeStyle = dashed ? 'dashed' : style.strokeStyle;

  const base = baseElementFields({
    id,
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height,
    angle: degreesToRadians(p.angle ?? 0),
    strokeColor: style.strokeColor,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: style.strokeWidth,
    strokeStyle,
    roughness: style.roughness,
    opacity: p.opacity ?? 100,
    roundness: p.rounded ? { type: 2 } : null,
    locked: p.locked ?? false,
    link: p.link ?? null,
    customData: { ...(p.customData ?? {}), drawcastPrimitiveId: p.id },
  });

  const element: ExcalidrawLineElement = {
    ...base,
    type: 'line',
    angle: base.angle as Radians,
    points,
    lastCommittedPoint: null,
    startArrowhead: null,
    endArrowhead: null,
    polygon: p.polygon === true,
  };

  ctx.emit(element);
  ctx.registerPrimitive(p.id, {
    kind: 'line',
    elementIds: [id],
    primaryId: id,
    bbox: {
      x: normalized.x,
      y: normalized.y,
      w: normalized.width,
      h: normalized.height,
    },
  });
}
