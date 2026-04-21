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

// Perpendicular spacing between parallel connectors sharing an endpoint pair.
// Chosen to exceed typical label widths (~100px for short Korean/English
// edge labels) because Excalidraw repositions bound arrow labels onto each
// arrow's midpoint at render time — axis-offsets we store are ignored, so
// the perpendicular arrow offset is the only way to separate labels.
const PARALLEL_LANE_SPACING = 120;

// Residual axis offset kept for non-bound scenarios (e.g. free Point→Point
// connectors whose labels are not repositioned by Excalidraw's bound-text
// logic). Safe to keep modest since the perpendicular offset does the heavy
// lifting for the common shape-to-shape case.
const PARALLEL_LABEL_AXIS_OFFSET = 0.15;

export interface ConnectorLane {
  /** 0-based index of this connector within its parallel group. */
  index: number;
  /** Total connectors sharing the same unordered endpoint pair. */
  count: number;
}

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

type PortDir = 'N' | 'E' | 'S' | 'W';

// Major-axis heuristic: connector leaves the side that points most directly
// at the other node's centre. Ties (|dx| == |dy|) fall to horizontal so the
// layout stays stable for grid-aligned pairs.
function selectPortDirs(
  fromCenter: Point,
  toCenter: Point,
): { fromDir: PortDir; toDir: PortDir } {
  const dx = toCenter[0] - fromCenter[0];
  const dy = toCenter[1] - fromCenter[1];
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { fromDir: 'E', toDir: 'W' } : { fromDir: 'W', toDir: 'E' };
  }
  return dy >= 0 ? { fromDir: 'S', toDir: 'N' } : { fromDir: 'N', toDir: 'S' };
}

// Anchor point at the centre of a cardinal side, rotation-aware. Diamond
// and ellipse land on the corresponding vertex / axis end, which reads
// cleanly as a connector anchor.
function portPoint(record: PrimitiveRecord, ctx: CompileContext, dir: PortDir): Point {
  const element = ctx.getElementById(record.primaryId)!;
  const center = centerOfRecord(record);
  const halfW = record.bbox.w / 2;
  const halfH = record.bbox.h / 2;
  let local: Point;
  switch (dir) {
    case 'E':
      local = [center[0] + halfW, center[1]];
      break;
    case 'W':
      local = [center[0] - halfW, center[1]];
      break;
    case 'S':
      local = [center[0], center[1] + halfH];
      break;
    case 'N':
      local = [center[0], center[1] - halfH];
      break;
  }
  return rotatePoint(local, center, element.angle);
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

// Shift both endpoints perpendicular to the arrow direction so parallel
// connectors between the same pair of shapes render on separate lines.
// When `lane` is undefined or count<=1, the endpoints are returned unchanged.
function applyLaneOffset(
  start: Point,
  end: Point,
  lane: ConnectorLane | undefined,
): [Point, Point] {
  if (!lane || lane.count <= 1) return [start, end];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len = Math.hypot(dx, dy);
  if (len < 1) return [start, end];
  // Symmetric lane positions around the centerline: 2 lanes -> ±spacing/2,
  // 3 lanes -> -spacing, 0, +spacing, etc.
  const offset = (lane.index - (lane.count - 1) / 2) * PARALLEL_LANE_SPACING;
  if (offset === 0) return [start, end];
  // Canonicalise the direction so opposite-direction connectors in the same
  // pair derive the *same* perpendicular axis; otherwise a positive offset
  // for one arrow and a negative offset for its reverse twin cancel out and
  // both arrows land back on the centerline.
  const [cdx, cdy] = canonicaliseDirection(dx, dy);
  const nx = -cdy / len;
  const ny = cdx / len;
  return [
    [start[0] + nx * offset, start[1] + ny * offset],
    [end[0] + nx * offset, end[1] + ny * offset],
  ];
}

function canonicaliseDirection(dx: number, dy: number): [number, number] {
  if (dx > 0) return [dx, dy];
  if (dx < 0) return [-dx, -dy];
  return dy >= 0 ? [dx, dy] : [-dx, -dy];
}

function buildRawPoints(
  start: Point,
  end: Point,
  routing: 'straight' | 'elbow' | 'curved',
  startDir?: PortDir,
): Point[] {
  if (routing === 'elbow') {
    // Horizontal-first when the connector leaves an E/W port so the first
    // segment extends outward from the side; vertical-first for N/S ports.
    // Without a hint (point endpoints) pick the longer axis: this matches
    // the old behaviour for wide pairs and fixes the thin-tall case where
    // the forced (midX, startY) kink used to overshoot the source node.
    const horizontalFirst = startDir
      ? startDir === 'E' || startDir === 'W'
      : Math.abs(end[0] - start[0]) >= Math.abs(end[1] - start[1]);
    if (horizontalFirst) {
      // Axis-aligned: degenerate to a straight 2-point line so Excalidraw
      // doesn't render a visible kink on top of coincident points.
      if (Math.abs(start[1] - end[1]) < 1e-6) {
        return [[start[0], start[1]], [end[0], end[1]]];
      }
      const midX = (start[0] + end[0]) / 2;
      return [
        [start[0], start[1]],
        [midX, start[1]],
        [midX, end[1]],
        [end[0], end[1]],
      ];
    }
    if (Math.abs(start[0] - end[0]) < 1e-6) {
      return [[start[0], start[1]], [end[0], end[1]]];
    }
    const midY = (start[1] + end[1]) / 2;
    return [
      [start[0], start[1]],
      [start[0], midY],
      [end[0], midY],
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

export function emitConnector(
  p: Connector,
  ctx: CompileContext,
  lane?: ConnectorLane,
): void {
  const style = resolveEdgeStyle(p.style, ctx.theme, p.id, ctx);
  const routing = p.routing ?? 'straight';

  // 1) Endpoints -> scene-coordinate points. Bound references are anchored to
  //    the boundary now because Excalidraw 0.17.x renders exactly these points.
  //    Elbow routing snaps to cardinal ports (side midpoints) so the first
  //    kink extends out of a side rather than a corner. Straight/curved keep
  //    the centre-to-centre boundary hit for visual balance on diagonals.
  //
  //    When the primitive carries a `routedPath` we skip all of that: it
  //    means an external layout engine (ELK) already produced a waypoint
  //    sequence that avoids node bodies. Using the built-in elbow math on
  //    top would re-introduce the node-crossing regression the router
  //    was picked to prevent.
  const fromRes = resolveCenter(p.from, ctx, p.id, 'from');
  const toRes = resolveCenter(p.to, ctx, p.id, 'to');
  let start: Point;
  let end: Point;
  let rawPoints: Point[];
  if (p.routedPath !== undefined && p.routedPath.length >= 2) {
    // External layout engine (ELK) already routed this edge around node
    // bodies — lane offset and port snapping would only distort its work.
    const first = p.routedPath[0]!;
    const last = p.routedPath[p.routedPath.length - 1]!;
    start = [first[0], first[1]];
    end = [last[0], last[1]];
    rawPoints = p.routedPath.map((pt) => [pt[0], pt[1]] as Point);
  } else {
    let startDir: PortDir | undefined;
    let rawStart: Point;
    let rawEnd: Point;
    if (routing === 'elbow' && fromRes.record && toRes.record) {
      const dirs = selectPortDirs(fromRes.center, toRes.center);
      rawStart = portPoint(fromRes.record, ctx, dirs.fromDir);
      rawEnd = portPoint(toRes.record, ctx, dirs.toDir);
      startDir = dirs.fromDir;
    } else {
      rawStart = fromRes.record ? boundaryPoint(fromRes.record, ctx, toRes.center) : fromRes.center;
      rawEnd = toRes.record ? boundaryPoint(toRes.record, ctx, fromRes.center) : toRes.center;
    }
    // Parallel-lane offset applies to the built-in router path (main #33)
    // so bidirectional / parallel edges keep separated tracks. ELK output
    // above is exempted because ELK already spaces parallel edges itself.
    [start, end] = applyLaneOffset(rawStart, rawEnd, lane);
    rawPoints = buildRawPoints(start, end, routing, startDir);
  }
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
    const fontSize = style.fontSize ?? ctx.theme.defaultFontSize;
    const lineHeight = getLineHeight(fontFamily);
    const metrics = measureText({ text: p.label, fontSize, fontFamily });
    // Midpoint of the (shifted) endpoints. For parallel connectors we also
    // slide the label along the pair's *canonical* axis so opposite-direction
    // labels don't land at identical coordinates (midpoint ± offset along
    // each arrow's own direction cancels out — the two arrows share a
    // midpoint). Using the canonical axis breaks that symmetry.
    const mx = (start[0] + end[0]) / 2;
    const my = (start[1] + end[1]) / 2;
    const dxFull = end[0] - start[0];
    const dyFull = end[1] - start[1];
    const lenFull = Math.hypot(dxFull, dyFull);
    let midX = mx;
    let midY = my;
    if (lane && lane.count > 1 && lenFull >= 1) {
      const [cdx, cdy] = canonicaliseDirection(dxFull, dyFull);
      const ux = cdx / lenFull;
      const uy = cdy / lenFull;
      const axisShift =
        PARALLEL_LABEL_AXIS_OFFSET *
        (lane.index - (lane.count - 1) / 2) *
        lenFull;
      midX = mx + ux * axisShift;
      midY = my + uy * axisShift;
    }

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
