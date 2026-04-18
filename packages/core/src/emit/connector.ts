// Emitter for the Connector primitive: one arrow element plus optional
// label child. See docs/03 §347-462.
//
// Pitfall guards exercised here:
//   P3  — points[0] must be [0,0] after normalisation; (x,y) captures the
//         pre-normalisation start point
//   P13 — at least 2 points always
//   P17 — elbow arrows use FixedPointBinding with fixedPoint [0.4999, 0.5001]
//   P18 — orphan references degrade to a free arrow with a warning

import type { Connector, Point, PrimitiveId, Radians } from '../primitives.js';
import { baseElementFields } from '../utils/baseElementFields.js';
import { newElementId } from '../utils/id.js';
import { getLineHeight, measureText } from '../measure.js';
import type {
  ExcalidrawArrowElement,
  ExcalidrawTextElement,
  FixedPointBinding,
  PointBinding,
} from '../types/excalidraw.js';
import type { CompileContext, PrimitiveRecord } from '../compile/context.js';
import { resolveEdgeStyle } from '../compile/resolveStyle.js';
import { normalizePoints } from './shared/points.js';

// Elbow arrows oscillate when fixedPoint == [0.5, 0.5] (issue #9197).
// Nudge slightly off-centre; Excalidraw snaps to the correct face on first
// interaction. See P17.
const ELBOW_FIXED_POINT: readonly [number, number] = [0.4999, 0.5001];
// Default gap between arrow endpoint and shape boundary.
const DEFAULT_GAP = 1;

function centerOfRecord(record: PrimitiveRecord): Point {
  return [
    record.bbox.x + record.bbox.w / 2,
    record.bbox.y + record.bbox.h / 2,
  ];
}

function isPoint(ref: PrimitiveId | Point): ref is Point {
  return typeof ref !== 'string';
}

function resolveEndpoint(
  ref: PrimitiveId | Point,
  ctx: CompileContext,
  primitiveId: PrimitiveId,
  role: 'from' | 'to',
): Point {
  if (isPoint(ref)) {
    return [ref[0], ref[1]];
  }
  const record = ctx.getRecord(ref);
  if (!record) {
    ctx.pushWarning({
      code: 'UNKNOWN_REFERENCE',
      message: `Connector ${primitiveId}.${role} references unknown primitive '${String(ref)}'.`,
      primitiveId,
    });
    return [0, 0];
  }
  return centerOfRecord(record);
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
  isElbow: boolean,
): { binding: PointBinding | FixedPointBinding | null; ownerId: string | null } {
  if (isPoint(ref)) return { binding: null, ownerId: null };
  const record = ctx.getRecord(ref);
  if (!record) return { binding: null, ownerId: null };
  // Only shape-like targets are bindable. We keep LabelBox + Frame for now;
  // Sticky and coverage primitives are intentionally excluded.
  if (record.kind !== 'labelBox' && record.kind !== 'frame') {
    return { binding: null, ownerId: null };
  }
  if (isElbow) {
    const fixed: FixedPointBinding = {
      elementId: record.primaryId,
      focus: 0,
      gap: DEFAULT_GAP,
      fixedPoint: ELBOW_FIXED_POINT,
    };
    return { binding: fixed, ownerId: record.primaryId };
  }
  return {
    binding: { elementId: record.primaryId, focus: 0, gap: DEFAULT_GAP },
    ownerId: record.primaryId,
  };
}

export function emitConnector(p: Connector, ctx: CompileContext): void {
  const style = resolveEdgeStyle(p.style, ctx.theme, p.id, ctx);
  const routing = p.routing ?? 'straight';
  const isElbow = routing === 'elbow';

  // 1) Endpoints -> raw scene-coordinate points
  const start = resolveEndpoint(p.from, ctx, p.id, 'from');
  const end = resolveEndpoint(p.to, ctx, p.id, 'to');
  const rawPoints = buildRawPoints(start, end, routing);
  const { points, width, height } = normalizePoints(rawPoints);

  // 2) Bindings
  const { binding: startBinding, ownerId: startOwner } = buildBinding(
    p.from,
    ctx,
    isElbow,
  );
  const { binding: endBinding, ownerId: endOwner } = buildBinding(
    p.to,
    ctx,
    isElbow,
  );

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
    ...(p.customData !== undefined ? { customData: p.customData } : {}),
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
    elbowed: isElbow,
    // Elbow arrows expect [] (not null) so Excalidraw's editor can populate it.
    fixedSegments: isElbow ? [] : null,
    startIsSpecial: false,
    endIsSpecial: false,
    polygon: false,
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
      autoResize: true,
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
