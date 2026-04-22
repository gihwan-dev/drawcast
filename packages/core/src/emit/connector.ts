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
import { containsCjk, getLineHeight, measureText } from '../measure.js';
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

// High-contrast dark used for every edge label so red/muted/accent edges
// don't produce low-contrast bound text.
const EDGE_LABEL_TEXT_COLOR = '#1e1e1e';

export interface ConnectorLane {
  /** 0-based index of this connector within its parallel group. */
  index: number;
  /** Total connectors sharing the same unordered endpoint pair. */
  count: number;
}

function centerOfRecord(record: PrimitiveRecord): Point {
  return [record.bbox.x + record.bbox.w / 2, record.bbox.y + record.bbox.h / 2];
}

/**
 * Pick a label anchor on the edge polyline that matches Excalidraw 0.17.x's
 * own `getBoundTextElementPosition` logic: odd-count → the middle waypoint,
 * even-count → the midpoint of the middle segment. For 2-point (straight)
 * routes this collapses to the straight-line midpoint, so existing call
 * sites behave identically. Routed polylines (elbow, ELK `routedPath`)
 * land the label on the segment that actually carries the drawn edge
 * instead of floating at the diagonal midpoint between shapes.
 */
function computeLabelAnchor(points: readonly Point[]): Point {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) {
    const only = points[0]!;
    return [only[0], only[1]];
  }
  if (points.length % 2 === 1) {
    const mid = points[Math.floor(points.length / 2)]!;
    return [mid[0], mid[1]];
  }
  const i = points.length / 2 - 1;
  const a = points[i]!;
  const b = points[i + 1]!;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
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

// Margin added on top of an obstacle's bbox when detouring an axis-aligned
// straight connector around it. Chosen to leave a visible gap between the
// detoured line and the node edge so edge labels (which Excalidraw pins to
// the polyline midpoint) don't visually touch the bypassed node.
const OBSTACLE_DETOUR_MARGIN = 20;

// Perpendicular jog shorter than this is treated as a visual kink rather than
// a meaningful bend. ELK routing sometimes stitches adjacent channels with a
// few-pixel offset (e.g. flow-login-01 "재시도" edge: 9px horizontal between
// two tall verticals) that reads as a double bend at the same corner; the VLM
// rubric has flagged this specifically. 16px is safely below the smallest
// single-character label height (~25px) so any real orthogonal segment that
// separates labelled channels is preserved.
const TINY_JOG_LENGTH = 16;

interface ObstacleBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Liang–Barsky strict-interior test: does the segment `start → end` cross
 * the interior of `b`, or only graze an edge? Returns true iff there is a
 * sub-segment of non-trivial length lying strictly inside the bbox. Grazes
 * and touches return false, so a connector whose endpoint sits flush with
 * an obstacle edge (the normal boundary-to-boundary anchoring) doesn't
 * trigger a detour.
 */
function segmentCrossesBBoxInterior(
  start: Point,
  end: Point,
  b: ObstacleBBox,
): boolean {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) {
      // Segment is parallel to this clip edge; inside iff q >= 0.
      return q >= 0;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, start[0] - b.x)) return false;
  if (!clip(dx, b.x + b.w - start[0])) return false;
  if (!clip(-dy, start[1] - b.y)) return false;
  if (!clip(dy, b.y + b.h - start[1])) return false;
  // Require a non-trivial interior slice: excludes pure edge-grazes and
  // segments that only touch a corner.
  return t1 - t0 > 1e-3 && t0 < 1 - 1e-3 && t1 > 1e-3;
}

/**
 * Scan the registry for a LabelBox whose bbox strictly crosses the straight
 * segment from `start` to `end`, ignoring the endpoint-owning primitives
 * themselves. Returns the first such obstacle or `null`.
 *
 * Phase 2 scope: only invoked on the sync compile path (no ELK routedPath)
 * for `routing:'straight'` segments — ELK already routes around nodes, and
 * elbow/curved paths already bend. Handles the common regression where an
 * LLM stacks three nodes on the same axis ("Web → Redis → DB" in the
 * arch-cdn-03 eval) and emits a straight arrow that skips the middle node:
 * the line and its bound label render on top of the bypassed node's text.
 */
function findBlockingLabelBox(
  start: Point,
  end: Point,
  excludeIds: ReadonlySet<PrimitiveId>,
  ctx: CompileContext,
): ObstacleBBox | null {
  for (const [id, record] of ctx.registry) {
    if (excludeIds.has(id)) continue;
    if (record.kind !== 'labelBox') continue;
    if (segmentCrossesBBoxInterior(start, end, record.bbox)) return record.bbox;
  }
  return null;
}

/** Gap the label keeps around any LabelBox after nudging. */
const LABEL_NUDGE_GAP = 4;
/** Cap on nudge iterations so we never loop on an unsolvable case. */
const LABEL_NUDGE_MAX_ITER = 6;

/**
 * Axis-aligned bbox overlap. Uses strict `<` so boxes that share exactly an
 * edge pixel don't count (matches `countOverlaps` in the eval metrics).
 */
function bboxOverlaps(
  x: number,
  y: number,
  w: number,
  h: number,
  b: ObstacleBBox,
): boolean {
  return x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y;
}

function findOverlappingLabelBox(
  labelX: number,
  labelY: number,
  labelW: number,
  labelH: number,
  excludeIds: ReadonlySet<PrimitiveId>,
  ctx: CompileContext,
): ObstacleBBox | null {
  for (const [id, record] of ctx.registry) {
    if (excludeIds.has(id)) continue;
    if (record.kind !== 'labelBox') continue;
    if (bboxOverlaps(labelX, labelY, labelW, labelH, record.bbox)) {
      return record.bbox;
    }
  }
  return null;
}

/**
 * Slide the edge-label anchor along the tangent direction until the label's
 * bbox no longer overlaps any non-endpoint LabelBox. Needed because the
 * polyline midpoint can sit just inside a neighbour node when ELK packs
 * nodes close together (arch-cdn-03: "읽기"/"쓰기" labels clipping the
 * edge of the Redis Cache box). Returns the adjusted anchor centre, or
 * the original if no clear position was found within the iteration cap.
 */
function nudgeLabelAwayFromNodes(
  midX: number,
  midY: number,
  labelW: number,
  labelH: number,
  tangent: Point,
  excludeIds: ReadonlySet<PrimitiveId>,
  ctx: CompileContext,
): Point {
  const tLen = Math.hypot(tangent[0], tangent[1]);
  // Degenerate tangent (zero-length segment): give up — the label has no
  // direction to slide along without leaving the edge altogether.
  if (tLen < 1e-6) return [midX, midY];
  const tx = tangent[0] / tLen;
  const ty = tangent[1] / tLen;

  let cx = midX;
  let cy = midY;
  for (let i = 0; i < LABEL_NUDGE_MAX_ITER; i += 1) {
    const x = cx - labelW / 2;
    const y = cy - labelH / 2;
    const hit = findOverlappingLabelBox(x, y, labelW, labelH, excludeIds, ctx);
    if (!hit) return [cx, cy];
    // Slide away from the obstacle centre along the tangent. Projecting
    // the "away" vector onto the tangent picks the side of the overlap
    // that is closer to clear space along the edge.
    const awayDx = cx - (hit.x + hit.w / 2);
    const awayDy = cy - (hit.y + hit.h / 2);
    const dir = awayDx * tx + awayDy * ty >= 0 ? 1 : -1;
    // Distance needed to clear the obstacle along tangent — take the
    // larger axis overlap so a single shift usually resolves.
    const overlapX = Math.min(x + labelW - hit.x, hit.x + hit.w - x);
    const overlapY = Math.min(y + labelH - hit.y, hit.y + hit.h - y);
    const shift = Math.max(overlapX, overlapY, 1) + LABEL_NUDGE_GAP;
    cx += tx * shift * dir;
    cy += ty * shift * dir;
  }
  return [midX, midY];
}

/**
 * Tangent vector at the label anchor, matching `computeLabelAnchor`'s
 * segment choice so a nudge slides the label along the visible edge line.
 */
function tangentAtLabelAnchor(points: readonly Point[]): Point {
  if (points.length < 2) return [1, 0];
  if (points.length % 2 === 1) {
    // Middle waypoint: average the incoming and outgoing directions so a
    // corner kink gives a sensible glide direction.
    const i = Math.floor(points.length / 2);
    const prev = points[i - 1]!;
    const next = points[i + 1]!;
    return [next[0] - prev[0], next[1] - prev[1]];
  }
  const i = points.length / 2 - 1;
  const a = points[i]!;
  const b = points[i + 1]!;
  return [b[0] - a[0], b[1] - a[1]];
}

/**
 * Build an L-shaped detour around `obstacle` going via the single corner
 * that lies on the far side of the obstacle relative to the straight line.
 * The detour replaces a 2-point line with 3 points [start, corner, end];
 * for axis-aligned inputs this generalises to 4 points [start, bend,
 * bend, end] via the dedicated axis-aligned branch because pinning the
 * corner on only one axis would rebuild the same vertical/horizontal
 * crossing on the opposite edge.
 *
 * Strategy: try each of the 4 obstacle corners (inflated by a margin),
 * filter to those whose two new sub-segments don't re-enter the obstacle,
 * and pick the one with the shortest total length. Falls back to a 4-point
 * axis-aligned bypass when no 3-point route clears the obstacle (this is
 * the common case for a vertical or horizontal straight arrow that passed
 * through the obstacle's full height/width).
 */
function detourAroundObstacle(
  start: Point,
  end: Point,
  obstacle: ObstacleBBox,
): Point[] {
  const m = OBSTACLE_DETOUR_MARGIN;
  const vertical = Math.abs(start[0] - end[0]) < 1e-6;
  const horizontal = Math.abs(start[1] - end[1]) < 1e-6;
  if (vertical || horizontal) {
    // Axis-aligned inputs: a 3-point L can't help because the arrow's
    // degenerate axis has to bend twice to clear both edges of the
    // obstacle. Use the dedicated 4-point bypass that picks the side
    // closer to the source endpoint.
    if (vertical) {
      const leftX = obstacle.x - m;
      const rightX = obstacle.x + obstacle.w + m;
      const detourX =
        Math.abs(start[0] - leftX) < Math.abs(start[0] - rightX)
          ? leftX
          : rightX;
      return [
        [start[0], start[1]],
        [detourX, start[1]],
        [detourX, end[1]],
        [end[0], end[1]],
      ];
    }
    const topY = obstacle.y - m;
    const botY = obstacle.y + obstacle.h + m;
    const detourY =
      Math.abs(start[1] - topY) < Math.abs(start[1] - botY) ? topY : botY;
    return [
      [start[0], start[1]],
      [start[0], detourY],
      [end[0], detourY],
      [end[0], end[1]],
    ];
  }
  const candidates: Point[] = [
    [obstacle.x - m, obstacle.y - m],
    [obstacle.x + obstacle.w + m, obstacle.y - m],
    [obstacle.x - m, obstacle.y + obstacle.h + m],
    [obstacle.x + obstacle.w + m, obstacle.y + obstacle.h + m],
  ];
  let best: { path: Point[]; length: number } | null = null;
  for (const corner of candidates) {
    if (segmentCrossesBBoxInterior(start, corner, obstacle)) continue;
    if (segmentCrossesBBoxInterior(corner, end, obstacle)) continue;
    const len =
      Math.hypot(corner[0] - start[0], corner[1] - start[1]) +
      Math.hypot(end[0] - corner[0], end[1] - corner[1]);
    if (!best || len < best.length) {
      best = {
        path: [
          [start[0], start[1]],
          [corner[0], corner[1]],
          [end[0], end[1]],
        ],
        length: len,
      };
    }
  }
  if (best) return best.path;
  // Every corner is blocked (degenerate layout, e.g. endpoints flanking
  // the obstacle on opposite sides). Fall back to a U-shape going over
  // the top: this at least moves the polyline midpoint off the obstacle.
  const topY = obstacle.y - m;
  return [
    [start[0], start[1]],
    [start[0], topY],
    [end[0], topY],
    [end[0], end[1]],
  ];
}

type SegmentAxis = 'h' | 'v' | null;

function segmentAxis(a: Point, b: Point): SegmentAxis {
  const dx = Math.abs(a[0] - b[0]);
  const dy = Math.abs(a[1] - b[1]);
  if (dx < 1e-6 && dy > 1e-6) return 'v';
  if (dy < 1e-6 && dx > 1e-6) return 'h';
  return null;
}

function pathClearOfLabelBoxes(
  points: readonly Point[],
  excludeIds: ReadonlySet<PrimitiveId>,
  ctx: CompileContext,
): boolean {
  for (const [id, record] of ctx.registry) {
    if (excludeIds.has(id)) continue;
    if (record.kind !== 'labelBox') continue;
    for (let i = 0; i < points.length - 1; i += 1) {
      if (segmentCrossesBBoxInterior(points[i]!, points[i + 1]!, record.bbox)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Collapse three consecutive points P0-P1-P2 where P0→P1 and P1→P2 share the
 * same direction (collinear and same sign). ELK routing never emits these on
 * its own, but orthogonal-jog merging below can introduce them (shifting a
 * short perpendicular step into the same line as a neighbouring segment).
 * Endpoints are always preserved.
 */
function collapseCollinear(points: readonly Point[]): Point[] {
  if (points.length < 3) return points.map((pt) => [pt[0], pt[1]] as Point);
  const result: Point[] = [[points[0]![0], points[0]![1]]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = result[result.length - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;
    const d1x = curr[0] - prev[0];
    const d1y = curr[1] - prev[1];
    const d2x = next[0] - curr[0];
    const d2y = next[1] - curr[1];
    const cross = d1x * d2y - d1y * d2x;
    const dot = d1x * d2x + d1y * d2y;
    if (Math.abs(cross) < 1e-6 && dot > 0) continue;
    result.push([curr[0], curr[1]]);
  }
  const last = points[points.length - 1]!;
  result.push([last[0], last[1]]);
  return result;
}

/**
 * Merge tiny orthogonal jogs in an ELK-routed polyline. A jog is a 4-point
 * window A-B-C-D where A→B and C→D are parallel (both horizontal or both
 * vertical) and B→C is a perpendicular segment shorter than
 * `TINY_JOG_LENGTH`. Visually this reads as a doubled kink at the same
 * corner. We replace it with a single-bend L-shape via either A's column or
 * D's column, picking whichever variant doesn't cross another node's bbox.
 *
 * Endpoints (index 0 and last) are preserved so bindings remain intact. On
 * every successful merge we re-run collinear collapse because the neighbour
 * segments often become colinear after the shift (the eval-hit case reduces
 * from 6 points to 4 points in one pass).
 */
function mergeTinyJogs(
  points: readonly Point[],
  excludeIds: ReadonlySet<PrimitiveId>,
  ctx: CompileContext,
): Point[] {
  let current: Point[] = points.map((pt) => [pt[0], pt[1]] as Point);
  let safetyCounter = current.length * 4;
  for (;;) {
    if (safetyCounter-- <= 0) break;
    if (current.length < 4) break;
    let mutated = false;
    for (let i = 0; i <= current.length - 4; i += 1) {
      const a = current[i]!;
      const b = current[i + 1]!;
      const c = current[i + 2]!;
      const d = current[i + 3]!;
      const ab = segmentAxis(a, b);
      const bc = segmentAxis(b, c);
      const cd = segmentAxis(c, d);
      if (ab === null || bc === null || cd === null) continue;
      if (ab !== cd) continue;
      if (bc === ab) continue;
      const jogLen = ab === 'v' ? Math.abs(c[0] - b[0]) : Math.abs(c[1] - b[1]);
      if (jogLen >= TINY_JOG_LENGTH) continue;
      const viaA: Point[] =
        ab === 'v'
          ? [a, [a[0], d[1]], d]
          : [a, [d[0], a[1]], d];
      const viaD: Point[] =
        ab === 'v'
          ? [a, [d[0], a[1]], d]
          : [a, [a[0], d[1]], d];
      let picked: Point[] | null = null;
      if (pathClearOfLabelBoxes(viaA, excludeIds, ctx)) picked = viaA;
      else if (pathClearOfLabelBoxes(viaD, excludeIds, ctx)) picked = viaD;
      if (picked === null) continue;
      current = [
        ...current.slice(0, i),
        ...picked.map((pt) => [pt[0], pt[1]] as Point),
        ...current.slice(i + 4),
      ];
      current = collapseCollinear(current);
      mutated = true;
      break;
    }
    if (!mutated) break;
  }
  return current;
}

/**
 * Rebalance a V-H-V (or H-V-H) 4-point window whose two parallel legs are
 * very uneven: specifically one parallel leg shorter than `TINY_JOG_LENGTH`
 * while the middle perpendicular segment is long enough that
 * `mergeTinyJogs` left the window intact. ELK sometimes pins the crossing
 * to a near-source (or near-target) channel, which reads as a tiny stub at
 * one end plus a long stub at the other — and because bound edge labels
 * sit on the middle segment (`computeLabelAnchor`), the label ends up
 * visually squished against the source (or target) node instead of between
 * them (flow-login-01 "성공" branch: legs 10 / 182 / 135 → label at the
 * 10px stub corner, right under the decision diamond).
 *
 * Shift B and C so the crossing runs along the midpoint of A and D on the
 * parallel axis. Endpoints stay pinned. The shifted path must still clear
 * every non-endpoint LabelBox; if not, leave the original shape alone so
 * we don't trade a visual-balance fix for a node-crossing regression.
 */
function rebalanceUnevenElbow(
  points: readonly Point[],
  excludeIds: ReadonlySet<PrimitiveId>,
  ctx: CompileContext,
): Point[] {
  if (points.length !== 4) return points.map((pt) => [pt[0], pt[1]] as Point);
  const a = points[0]!;
  const b = points[1]!;
  const c = points[2]!;
  const d = points[3]!;
  const ab = segmentAxis(a, b);
  const bc = segmentAxis(b, c);
  const cd = segmentAxis(c, d);
  if (ab === null || bc === null || cd === null) {
    return points.map((pt) => [pt[0], pt[1]] as Point);
  }
  if (ab !== cd || bc === ab) {
    return points.map((pt) => [pt[0], pt[1]] as Point);
  }
  const firstLen = ab === 'v' ? Math.abs(b[1] - a[1]) : Math.abs(b[0] - a[0]);
  const lastLen = cd === 'v' ? Math.abs(d[1] - c[1]) : Math.abs(d[0] - c[0]);
  const shortLen = Math.min(firstLen, lastLen);
  const longLen = Math.max(firstLen, lastLen);
  if (shortLen >= TINY_JOG_LENGTH) {
    return points.map((pt) => [pt[0], pt[1]] as Point);
  }
  if (longLen < TINY_JOG_LENGTH * 2) {
    return points.map((pt) => [pt[0], pt[1]] as Point);
  }
  const midpoint =
    ab === 'v' ? (a[1] + d[1]) / 2 : (a[0] + d[0]) / 2;
  const rebalanced: Point[] =
    ab === 'v'
      ? [
          [a[0], a[1]],
          [a[0], midpoint],
          [d[0], midpoint],
          [d[0], d[1]],
        ]
      : [
          [a[0], a[1]],
          [midpoint, a[1]],
          [midpoint, d[1]],
          [d[0], d[1]],
        ];
  if (!pathClearOfLabelBoxes(rebalanced, excludeIds, ctx)) {
    return points.map((pt) => [pt[0], pt[1]] as Point);
  }
  return rebalanced;
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
    const raw = p.routedPath.map((pt) => [pt[0], pt[1]] as Point);
    // Collapse any collinear pairs ELK emitted as-is, then merge tiny
    // perpendicular jogs that read as a doubled corner (flow-login-01
    // "재시도" case). The obstacle check reuses the labelBox registry so
    // we never shift a column onto another node's body.
    const excludeIds = new Set<PrimitiveId>();
    if (typeof p.from === 'string') excludeIds.add(p.from);
    if (typeof p.to === 'string') excludeIds.add(p.to);
    rawPoints = rebalanceUnevenElbow(
      mergeTinyJogs(collapseCollinear(raw), excludeIds, ctx),
      excludeIds,
      ctx,
    );
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
    // Sync-path obstacle detour. When an LLM stacks three nodes on the
    // same axis (e.g. Web → Redis → DB in arch-cdn-03) and wires a
    // straight Web→DB connector, the boundary-to-boundary line slices
    // clean through the middle node's text. ELK would have routed around
    // it, but the scene contains frames so buildGraphModel skipped ELK
    // entirely. Detect the case here and insert a two-bend detour.
    if (routing === 'straight' && p.routedPath === undefined) {
      const excludeIds = new Set<PrimitiveId>();
      if (typeof p.from === 'string') excludeIds.add(p.from);
      if (typeof p.to === 'string') excludeIds.add(p.to);
      const obstacle = findBlockingLabelBox(start, end, excludeIds, ctx);
      if (obstacle) {
        rawPoints = detourAroundObstacle(start, end, obstacle);
      }
    }
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
    // Widen the bound-label bbox for CJK text. Our static `measureText`
    // lands on exactly the runtime pixel width for Latin glyphs, but the
    // default Excalidraw fonts (Excalifont / Virgil / Cascadia) ship no
    // Hangul / Kana glyphs — the renderer falls back to the platform
    // font, which measures slightly wider per glyph. A tight bbox makes
    // `refreshTextDimensions` wrap a 3-char Korean label into three
    // single-character lines that then render as a vertical stack
    // (flow-login-01 "재시도" case). An `fontSize * 0.3` safety margin
    // covers the measured fallback overshoot without noticeably shifting
    // the label's visual centre.
    const cjkWidthBuffer = containsCjk(p.label)
      ? Math.ceil(fontSize * 0.3)
      : 0;
    const labelWidth = metrics.width + cjkWidthBuffer;
    // Anchor on the polyline, not the straight line between endpoints.
    // For orthogonally routed feedback edges (ELK `routedPath`, or the
    // built-in elbow router) the straight-line midpoint can fall far off
    // the visible edge path — e.g. the "재시도" label in flow-login-01
    // was floating in open space between shapes. Matching Excalidraw
    // 0.17.x's own `getBoundTextElementPosition` (odd points → middle
    // point; even points → middle-segment midpoint) keeps the emit-time
    // position consistent with how the editor repositions the label on
    // interaction, and lands labels on the segment that actually carries
    // the edge.
    //
    // For parallel connectors we additionally slide the label along the
    // pair's *canonical* axis so opposite-direction labels don't land at
    // identical coordinates (midpoint ± offset along each arrow's own
    // direction cancels out — the two arrows share a midpoint). Using
    // the canonical axis breaks that symmetry.
    const [mx, my] = computeLabelAnchor(rawPoints);
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

    // Shift the anchor along the edge tangent when the label bbox overlaps
    // a neighbouring LabelBox. ELK can pack nodes close enough that the
    // polyline midpoint lands ~2px inside an adjacent box (arch-cdn-03:
    // "읽기"/"쓰기" labels clipping the Redis Cache corner). Endpoints
    // are excluded so labels still rest flush against their own source
    // and target boxes — that's expected behaviour for a bound label.
    const labelExclude = new Set<PrimitiveId>();
    if (typeof p.from === 'string') labelExclude.add(p.from);
    if (typeof p.to === 'string') labelExclude.add(p.to);
    [midX, midY] = nudgeLabelAwayFromNodes(
      midX,
      midY,
      labelWidth,
      metrics.height,
      tangentAtLabelAnchor(rawPoints),
      labelExclude,
      ctx,
    );

    const labelBase = baseElementFields({
      id: labelId,
      x: midX - labelWidth / 2,
      y: midY - metrics.height / 2,
      width: labelWidth,
      height: metrics.height,
      angle: 0 as Radians,
      // Edge labels always render in a high-contrast dark color, not the
      // edge's stroke color. Tinted edges (accent/muted/custom) drag label
      // text below AA contrast against the canvas, and VLM rubrics flag the
      // resulting short labels ("재입력", "재발송", …) as illegible.
      strokeColor: EDGE_LABEL_TEXT_COLOR,
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

/**
 * Perpendicular offsets (in px) tried when shifting a crowded middle segment
 * so the anchored label clears neighbouring edges. Ordered small-first so the
 * visible polyline change is minimised.
 */
const MIDDLE_SEGMENT_SHIFTS = [30, -30, 50, -50, 80, -80] as const;

/**
 * Walk every emitted bound edge label and, when its bbox lands on a non-own
 * arrow's polyline segment, shift the OWN arrow's middle segment
 * perpendicular until the label clears. Targets 4-point orthogonal routes
 * (H-V-H or V-H-V) produced by ELK for converging feedback fans — e.g. the
 * `flow-ci-04` CI pipeline, where five "실패" edges share a narrow vertical
 * corridor and the labels stack on top of adjacent vertical stems.
 *
 * Why a post-pass: bound-text positions are recomputed by Excalidraw at
 * render time from the arrow's middle-segment midpoint (`getBoundTextElement
 * Position`), so moving the text element itself has no effect — the fix has
 * to move the *arrow*. The per-connector emit can only see previously
 * emitted arrows, so the final global view lives here.
 *
 * Conservative by design: rolls back if no shift clears, refuses shifts that
 * would push a leg through a non-endpoint LabelBox, and only touches
 * polylines whose shape matches the known regression.
 */
export function clearEdgeLabelsFromOtherArrows(ctx: CompileContext): void {
  const arrows: ExcalidrawArrowElement[] = [];
  for (const e of ctx.elements) {
    if (e.type === 'arrow') arrows.push(e as ExcalidrawArrowElement);
  }
  if (arrows.length < 2) return;

  const textByArrow = new Map<string, ExcalidrawTextElement>();
  for (const e of ctx.elements) {
    if (e.type !== 'text') continue;
    const t = e as ExcalidrawTextElement;
    if (typeof t.containerId === 'string') {
      textByArrow.set(t.containerId, t);
    }
  }

  function absPts(arrow: ExcalidrawArrowElement): Point[] {
    return arrow.points.map(
      ([px, py]) => [arrow.x + px, arrow.y + py] as Point,
    );
  }

  function labelBbox(
    arrow: ExcalidrawArrowElement,
    text: ExcalidrawTextElement,
  ): ObstacleBBox {
    const pts = absPts(arrow);
    const [cx, cy] = computeLabelAnchor(pts);
    return {
      x: cx - text.width / 2,
      y: cy - text.height / 2,
      w: text.width,
      h: text.height,
    };
  }

  function anyOtherArrowCrossesBox(
    ownId: string,
    box: ObstacleBBox,
  ): boolean {
    for (const other of arrows) {
      if (other.id === ownId) continue;
      const opts = absPts(other);
      for (let i = 0; i < opts.length - 1; i += 1) {
        if (segmentCrossesBBoxInterior(opts[i]!, opts[i + 1]!, box)) {
          return true;
        }
      }
    }
    return false;
  }

  function endpointPrimitiveIds(
    arrow: ExcalidrawArrowElement,
  ): Set<PrimitiveId> {
    const excludeIds = new Set<PrimitiveId>();
    const startElemId = arrow.startBinding?.elementId;
    const endElemId = arrow.endBinding?.elementId;
    for (const [primId, rec] of ctx.registry) {
      if (rec.kind !== 'labelBox') continue;
      if (
        (startElemId !== undefined && rec.elementIds.includes(startElemId)) ||
        (endElemId !== undefined && rec.elementIds.includes(endElemId))
      ) {
        excludeIds.add(primId);
      }
    }
    return excludeIds;
  }

  for (const arrow of arrows) {
    const text = textByArrow.get(arrow.id);
    if (!text) continue;
    if (arrow.points.length !== 4) continue;
    const p0 = arrow.points[0]!;
    const p1 = arrow.points[1]!;
    const p2 = arrow.points[2]!;
    const p3 = arrow.points[3]!;
    const ax01 = segmentAxis(p0 as Point, p1 as Point);
    const ax12 = segmentAxis(p1 as Point, p2 as Point);
    const ax23 = segmentAxis(p2 as Point, p3 as Point);
    if (ax01 === null || ax12 === null || ax23 === null) continue;
    if (ax01 !== ax23 || ax12 === ax01) continue;

    if (!anyOtherArrowCrossesBox(arrow.id, labelBbox(arrow, text))) continue;

    const excludePrims = endpointPrimitiveIds(arrow);
    const orig1: Point = [p1[0], p1[1]];
    const orig2: Point = [p2[0], p2[1]];
    let resolved = false;

    for (const shift of MIDDLE_SEGMENT_SHIFTS) {
      if (ax12 === 'v') {
        arrow.points[1] = [orig1[0] + shift, orig1[1]] as typeof arrow.points[0];
        arrow.points[2] = [orig2[0] + shift, orig2[1]] as typeof arrow.points[0];
      } else {
        arrow.points[1] = [orig1[0], orig1[1] + shift] as typeof arrow.points[0];
        arrow.points[2] = [orig2[0], orig2[1] + shift] as typeof arrow.points[0];
      }

      const shiftedAbs = absPts(arrow);
      const crossesNode =
        !pathClearOfLabelBoxes(shiftedAbs, excludePrims, ctx);
      if (crossesNode) continue;

      if (!anyOtherArrowCrossesBox(arrow.id, labelBbox(arrow, text))) {
        updateArrowExtents(arrow);
        resolved = true;
        break;
      }
    }

    if (!resolved) {
      arrow.points[1] = orig1 as typeof arrow.points[0];
      arrow.points[2] = orig2 as typeof arrow.points[0];
    }
  }
}

/**
 * Recompute `width` / `height` from the current local-point list. `x` / `y`
 * stay fixed because `points[0]` remains `[0,0]` (P3); only the spanned bbox
 * can change when an interior point is nudged perpendicular.
 */
function updateArrowExtents(arrow: ExcalidrawArrowElement): void {
  if (arrow.points.length === 0) return;
  let minX = arrow.points[0]![0];
  let maxX = minX;
  let minY = arrow.points[0]![1];
  let maxY = minY;
  for (const [px, py] of arrow.points) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  arrow.width = maxX - minX;
  arrow.height = maxY - minY;
}
