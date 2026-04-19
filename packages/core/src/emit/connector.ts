// Emitter for the Connector primitive: one arrow element plus optional
// label child. See docs/03 §347-462.
//
// Pitfall guards exercised here:
//   P3  — points[0] must be [0,0] after normalisation; (x,y) captures the
//         pre-normalisation start point
//   P13 — at least 2 points always
//   P18 — orphan references degrade to a free arrow with a warning
//
// Excalidraw 0.17.x baseline: no elbow-arrow fields (`elbowed`,
// `fixedSegments`, `fixedPoint`, …), no `polygon`, no `FixedPointBinding`.
// `PointBinding` is metadata for later bound-element updates; first paint uses
// the arrow's own `x`, `y`, and `points`, so we emit boundary coordinates.

import type { Connector, Point, PrimitiveId, Radians } from '../primitives.js';
import { baseElementFields } from '../utils/baseElementFields.js';
import { newElementId } from '../utils/id.js';
import { getLineHeight, measureText } from '../measure.js';
import type {
  ExcalidrawArrowElement,
  ExcalidrawTextElement,
  PointBinding,
} from '../types/excalidraw.js';
import type { CompileContext, PrimitiveRecord } from '../compile/context.js';
import { resolveEdgeStyle } from '../compile/resolveStyle.js';
import { normalizePoints } from './shared/points.js';

// Matches Excalidraw 0.17.x's minimum gap from calculateFocusAndGap().
const DEFAULT_GAP = 1;

function centerOfRecord(record: PrimitiveRecord): Point {
  return [record.bbox.x + record.bbox.w / 2, record.bbox.y + record.bbox.h / 2];
}

function isPoint(ref: PrimitiveId | Point): ref is Point {
  return typeof ref !== 'string';
}

function rotatePoint(point: Point, center: Point, angle: number): Point {
  if (angle === 0) return [point[0], point[1]];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point[0] - center[0];
  const dy = point[1] - center[1];
  return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos];
}

function boundaryPoint(record: PrimitiveRecord, ctx: CompileContext, towards: Point): Point {
  const element = ctx.getElementById(record.primaryId)!;
  const center = centerOfRecord(record);
  const localTowards = rotatePoint(towards, center, -element.angle);
  const dx = localTowards[0] - center[0];
  const dy = localTowards[1] - center[1];
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (absDx < 1e-6 && absDy < 1e-6) return center;

  const halfW = record.bbox.w / 2;
  const halfH = record.bbox.h / 2;
  let t: number;
  switch (element.type) {
    case 'diamond':
      t = 1 / (absDx / halfW + absDy / halfH);
      break;
    case 'ellipse':
      t = 1 / Math.sqrt((dx * dx) / (halfW * halfW) + (dy * dy) / (halfH * halfH));
      break;
    default:
      t = Math.min(
        absDx > 1e-6 ? halfW / absDx : Number.POSITIVE_INFINITY,
        absDy > 1e-6 ? halfH / absDy : Number.POSITIVE_INFINITY,
      );
  }

  return rotatePoint([center[0] + dx * t, center[1] + dy * t], center, element.angle);
}

interface ResolvedEndpointCenter {
  center: Point;
  /** Non-null only when the endpoint references a bindable primitive. */
  record: PrimitiveRecord | null;
}

function resolveCenter(
  ref: PrimitiveId | Point,
  ctx: CompileContext,
  primitiveId: PrimitiveId,
  role: 'from' | 'to',
): ResolvedEndpointCenter {
  if (isPoint(ref)) {
    return { center: [ref[0], ref[1]], record: null };
  }
  const record = ctx.getRecord(ref);
  if (!record) {
    ctx.pushWarning({
      code: 'UNKNOWN_REFERENCE',
      message: `Connector ${primitiveId}.${role} references unknown primitive '${String(ref)}'.`,
      primitiveId,
    });
    return { center: [0, 0], record: null };
  }
  return { center: centerOfRecord(record), record };
}

function buildRawPoints(
  start: Point,
  end: Point,
  routing: 'straight' | 'elbow' | 'curved',
): Point[] {
  if (routing === 'elbow') {
    const midX = (start[0] + end[0]) / 2;
    return [
      [start[0], start[1]],
      [midX, start[1]],
      [midX, end[1]],
      [end[0], end[1]],
    ];
  }
  if (routing === 'curved') {
    // Single cubic-ish midpoint offset perpendicular by 25% of length. The
    // exact shape doesn't matter; Excalidraw smooths arrows regardless.
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const len = Math.hypot(dx, dy);
    if (len < 1) {
      return [
        [start[0], start[1]],
        [end[0], end[1]],
      ];
    }
    const mx = (start[0] + end[0]) / 2;
    const my = (start[1] + end[1]) / 2;
    // perpendicular unit vector
    const nx = -dy / len;
    const ny = dx / len;
    const offset = len * 0.25;
    return [
      [start[0], start[1]],
      [mx + nx * offset, my + ny * offset],
      [end[0], end[1]],
    ];
  }
  // straight
  return [
    [start[0], start[1]],
    [end[0], end[1]],
  ];
}

function buildBinding(
  ref: PrimitiveId | Point,
  ctx: CompileContext,
): { binding: PointBinding | null; ownerId: string | null } {
  if (isPoint(ref)) return { binding: null, ownerId: null };
  const record = ctx.getRecord(ref);
  if (!record) return { binding: null, ownerId: null };
  // Only shape-like targets are bindable. We keep LabelBox + Frame for now;
  // Sticky and coverage primitives are intentionally excluded.
  if (record.kind !== 'labelBox' && record.kind !== 'frame') {
    return { binding: null, ownerId: null };
  }
  return {
    binding: { elementId: record.primaryId, focus: 0, gap: DEFAULT_GAP },
    ownerId: record.primaryId,
  };
}

export function emitConnector(p: Connector, ctx: CompileContext): void {
  const style = resolveEdgeStyle(p.style, ctx.theme, p.id, ctx);
  const routing = p.routing ?? 'straight';

  // 1) Endpoints -> scene-coordinate points. Bound references are anchored to
  //    the boundary now because Excalidraw 0.17.x renders exactly these points.
  const fromRes = resolveCenter(p.from, ctx, p.id, 'from');
  const toRes = resolveCenter(p.to, ctx, p.id, 'to');
  const start = fromRes.record ? boundaryPoint(fromRes.record, ctx, toRes.center) : fromRes.center;
  const end = toRes.record ? boundaryPoint(toRes.record, ctx, fromRes.center) : toRes.center;
  const rawPoints = buildRawPoints(start, end, routing);
  const { points, width, height } = normalizePoints(rawPoints);

  // 2) Bindings
  const { binding: startBinding, ownerId: startOwner } = buildBinding(p.from, ctx);
  const { binding: endBinding, ownerId: endOwner } = buildBinding(p.to, ctx);

  const arrowId = newElementId();
  const base = baseElementFields({
    id: arrowId,
    x: start[0],
    y: start[1],
    width,
    height,
    angle: 0 as Radians,
    strokeColor: style.strokeColor,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: style.strokeWidth,
    strokeStyle: style.strokeStyle,
    roughness: style.roughness,
    opacity: p.opacity ?? 100,
    roundness: routing === 'curved' ? { type: 2 } : null,
    locked: p.locked ?? false,
    link: p.link ?? null,
    customData: { ...(p.customData ?? {}), drawcastPrimitiveId: p.id },
  });

  const arrow: ExcalidrawArrowElement = {
    ...base,
    type: 'arrow',
    angle: base.angle as Radians,
    points,
    lastCommittedPoint: null,
    startBinding,
    endBinding,
    startArrowhead: p.arrowhead?.start ?? null,
    endArrowhead: p.arrowhead?.end ?? 'arrow',
  };

  ctx.emit(arrow);

  // 3) Reverse-side boundElements on owner shapes.
  if (startOwner) ctx.addBoundElement(startOwner, arrowId, 'arrow');
  if (endOwner) ctx.addBoundElement(endOwner, arrowId, 'arrow');

  // 4) Label child (optional).
  const elementIds: string[] = [arrowId];
  if (p.label) {
    const labelId = newElementId();
    const fontFamily = style.fontFamily ?? ctx.theme.defaultFontFamily;
    const fontSize = style.fontSize ?? 16;
    const lineHeight = getLineHeight(fontFamily);
    const metrics = measureText({ text: p.label, fontSize, fontFamily });
    // Midpoint of the raw (pre-normalisation) points: visually unimportant
    // because Excalidraw repositions bound arrow labels on first render.
    const midX = (start[0] + end[0]) / 2;
    const midY = (start[1] + end[1]) / 2;

    const labelBase = baseElementFields({
      id: labelId,
      x: midX - metrics.width / 2,
      y: midY - metrics.height / 2,
      width: metrics.width,
      height: metrics.height,
      angle: 0 as Radians,
      strokeColor: style.strokeColor,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: style.strokeWidth,
      strokeStyle: style.strokeStyle,
      roughness: style.roughness,
      opacity: p.opacity ?? 100,
      roundness: null,
      locked: p.locked ?? false,
      customData: { drawcastPrimitiveId: p.id },
    });

    const label: ExcalidrawTextElement = {
      ...labelBase,
      type: 'text',
      angle: labelBase.angle as Radians,
      text: p.label,
      originalText: p.label,
      fontSize,
      fontFamily,
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId: arrowId,
      lineHeight,
      baseline: Math.round(fontSize * lineHeight * 0.8),
    };

    ctx.emit(label);
    ctx.addBoundElement(arrowId, labelId, 'text');
    elementIds.push(labelId);
  }

  ctx.registerPrimitive(p.id, {
    kind: 'connector',
    elementIds,
    primaryId: arrowId,
    bbox: { x: start[0], y: start[1], w: width, h: height },
  });
}
