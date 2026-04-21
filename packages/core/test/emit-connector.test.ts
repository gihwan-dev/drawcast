// Connector endpoint + binding regression tests.
//
// The arrow is emitted with centre-to-centre points; Excalidraw re-anchors
// the visible endpoints to each shape's boundary on first paint using
// `startBinding.focus`/`gap`. Pre-calculating boundary points in the
// emitter (an earlier attempt) races with Excalidraw's restore() and
// leaves the arrow misaligned on the user-visible B3 bug. These tests
// pin the invariants the compiled scene must carry so the first paint
// lands correctly.

import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile/index.js';
import { sketchyTheme } from '../src/theme.js';
import type {
  Connector,
  LabelBox,
  Primitive,
  PrimitiveId,
  Scene,
} from '../src/primitives.js';
import type {
  ExcalidrawArrowElement,
  ExcalidrawRectangleElement,
} from '../src/types/excalidraw.js';

function makeScene(primitives: Primitive[]): Scene {
  return {
    primitives: new Map(primitives.map((p) => [p.id, p])),
    theme: sketchyTheme,
  };
}

function findArrow(
  elements: readonly {
    type: string;
  }[],
): ExcalidrawArrowElement {
  return elements.find(
    (e): e is ExcalidrawArrowElement => e.type === 'arrow',
  ) as ExcalidrawArrowElement;
}

describe('emitConnector — boundary anchoring (B3)', () => {
  it('horizontal pair: arrow lands on source right edge & target left edge', () => {
    // A at (100,100) fixed 80x40 → right edge (140, 100).
    // B at (300,100) fixed 80x40 → left edge (260, 100).
    // Excalidraw 0.17.x renders exactly these points on first paint —
    // bindings only take over on drag, so emit must pre-anchor.
    const a: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 100],
      fit: 'fixed',
      size: [80, 40],
      text: 'A',
    };
    const b: LabelBox = {
      kind: 'labelBox',
      id: 'b' as PrimitiveId,
      shape: 'rectangle',
      at: [300, 100],
      fit: 'fixed',
      size: [80, 40],
      text: 'B',
    };
    const c: Connector = {
      kind: 'connector',
      id: 'c' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: 'b' as PrimitiveId,
      routing: 'straight',
    };
    const result = compile(makeScene([a, b, c]));
    const arrow = findArrow(result.elements);

    // arrow origin == A's right edge midpoint.
    expect(arrow.x).toBe(140);
    expect(arrow.y).toBe(100);

    // Last point (in local coords) lands at B's left edge midpoint.
    const lastPoint = arrow.points[arrow.points.length - 1]!;
    expect(arrow.x + lastPoint[0]).toBe(260);
    expect(arrow.y + lastPoint[1]).toBe(100);

    // Bindings persisted so drag-re-anchor still works.
    expect(arrow.startBinding?.focus).toBe(0);
    expect(arrow.endBinding?.focus).toBe(0);
    expect(arrow.startBinding?.gap ?? 0).toBeGreaterThan(0);
  });

  it('vertical pair: arrow lands on source bottom edge & target top edge', () => {
    const a: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 100],
      fit: 'fixed',
      size: [80, 40],
      text: 'A',
    };
    const b: LabelBox = {
      kind: 'labelBox',
      id: 'b' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 300],
      fit: 'fixed',
      size: [80, 40],
      text: 'B',
    };
    const c: Connector = {
      kind: 'connector',
      id: 'c' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: 'b' as PrimitiveId,
      routing: 'straight',
    };
    const result = compile(makeScene([a, b, c]));
    const arrow = findArrow(result.elements);

    // A's bottom edge midpoint = (100, 120); B's top edge = (100, 280).
    expect(arrow.x).toBe(100);
    expect(arrow.y).toBe(120);

    const lastPoint = arrow.points[arrow.points.length - 1]!;
    expect(arrow.x + lastPoint[0]).toBe(100);
    expect(arrow.y + lastPoint[1]).toBe(280);
  });

  it('keeps startBinding / endBinding so Excalidraw still auto-re-anchors', () => {
    const a: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 100],
      fit: 'fixed',
      size: [80, 40],
      text: 'A',
    };
    const b: LabelBox = {
      kind: 'labelBox',
      id: 'b' as PrimitiveId,
      shape: 'rectangle',
      at: [300, 100],
      fit: 'fixed',
      size: [80, 40],
      text: 'B',
    };
    const c: Connector = {
      kind: 'connector',
      id: 'c' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: 'b' as PrimitiveId,
    };
    const result = compile(makeScene([a, b, c]));
    const arrow = findArrow(result.elements);
    const rects = result.elements.filter(
      (el): el is ExcalidrawRectangleElement => el.type === 'rectangle',
    );
    expect(arrow.startBinding?.elementId).toBe(rects[0]!.id);
    expect(arrow.endBinding?.elementId).toBe(rects[1]!.id);
  });

  it('elbow + horizontal pair: axis-aligned pair collapses to a straight 2-point line', () => {
    // A and B centres on the same y → elbow would otherwise emit a
    // degenerate kink on top of itself. Cardinal-port selection picks
    // E/W and the degenerate-axis guard returns a 2-point polyline.
    const a: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 100],
      fit: 'fixed',
      size: [80, 40],
      text: 'A',
    };
    const b: LabelBox = {
      kind: 'labelBox',
      id: 'b' as PrimitiveId,
      shape: 'rectangle',
      at: [300, 100],
      fit: 'fixed',
      size: [80, 40],
      text: 'B',
    };
    const c: Connector = {
      kind: 'connector',
      id: 'c' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: 'b' as PrimitiveId,
      routing: 'elbow',
    };
    const result = compile(makeScene([a, b, c]));
    const arrow = findArrow(result.elements);

    expect(arrow.x).toBe(140);
    expect(arrow.y).toBe(100);
    expect(arrow.points).toHaveLength(2);
    const last = arrow.points[1]!;
    expect(arrow.x + last[0]).toBe(260);
    expect(arrow.y + last[1]).toBe(100);
  });

  it('elbow + vertical pair: leaves the S port and arrives at N, collapses to straight', () => {
    const a: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 100],
      fit: 'fixed',
      size: [80, 40],
      text: 'A',
    };
    const b: LabelBox = {
      kind: 'labelBox',
      id: 'b' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 300],
      fit: 'fixed',
      size: [80, 40],
      text: 'B',
    };
    const c: Connector = {
      kind: 'connector',
      id: 'c' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: 'b' as PrimitiveId,
      routing: 'elbow',
    };
    const result = compile(makeScene([a, b, c]));
    const arrow = findArrow(result.elements);

    // A bottom-edge mid (100, 120) → B top-edge mid (100, 280).
    expect(arrow.x).toBe(100);
    expect(arrow.y).toBe(120);
    expect(arrow.points).toHaveLength(2);
    const last = arrow.points[1]!;
    expect(arrow.x + last[0]).toBe(100);
    expect(arrow.y + last[1]).toBe(280);
  });

  it('elbow + diagonal pair: horizontal-major leaves E, kinks at midX, enters W', () => {
    // Regression for the "arrow overshoots out of the top edge" bug. When
    // the source sits lower-left of the target, the previous logic anchored
    // near the top-right corner of A and then kinked upward, producing the
    // Z-with-detour seen in the user's flowchart. Cardinal ports plus
    // horizontal-first routing yield a clean Z: E → midX → up → W.
    const a: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 300],
      fit: 'fixed',
      size: [160, 60],
      text: 'A',
    };
    const b: LabelBox = {
      kind: 'labelBox',
      id: 'b' as PrimitiveId,
      shape: 'rectangle',
      at: [500, 100],
      fit: 'fixed',
      size: [160, 60],
      text: 'B',
    };
    const c: Connector = {
      kind: 'connector',
      id: 'c' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: 'b' as PrimitiveId,
      routing: 'elbow',
    };
    const result = compile(makeScene([a, b, c]));
    const arrow = findArrow(result.elements);

    // A right-edge mid (180, 300); B left-edge mid (420, 100).
    expect(arrow.x).toBe(180);
    expect(arrow.y).toBe(300);
    expect(arrow.points).toHaveLength(4);

    const toScene = (p: readonly [number, number]) =>
      [arrow.x + p[0], arrow.y + p[1]] as const;
    expect(toScene(arrow.points[0]!)).toEqual([180, 300]);
    expect(toScene(arrow.points[1]!)).toEqual([300, 300]); // midX, stay on start.y
    expect(toScene(arrow.points[2]!)).toEqual([300, 100]); // midX, rise to end.y
    expect(toScene(arrow.points[3]!)).toEqual([420, 100]);
  });

  it('elbow + vertical-major diagonal: leaves S, kinks at midY, enters N', () => {
    // Tall pair: |dy| > |dx| → vertical-first routing. Validates that we
    // do not blindly fall into midX kinking for every elbow.
    const a: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 100],
      fit: 'fixed',
      size: [80, 40],
      text: 'A',
    };
    const b: LabelBox = {
      kind: 'labelBox',
      id: 'b' as PrimitiveId,
      shape: 'rectangle',
      at: [200, 500],
      fit: 'fixed',
      size: [80, 40],
      text: 'B',
    };
    const c: Connector = {
      kind: 'connector',
      id: 'c' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: 'b' as PrimitiveId,
      routing: 'elbow',
    };
    const result = compile(makeScene([a, b, c]));
    const arrow = findArrow(result.elements);

    // A bottom-edge mid (100, 120); B top-edge mid (200, 480).
    expect(arrow.x).toBe(100);
    expect(arrow.y).toBe(120);
    expect(arrow.points).toHaveLength(4);

    const toScene = (p: readonly [number, number]) =>
      [arrow.x + p[0], arrow.y + p[1]] as const;
    expect(toScene(arrow.points[0]!)).toEqual([100, 120]);
    expect(toScene(arrow.points[1]!)).toEqual([100, 300]); // start.x, midY
    expect(toScene(arrow.points[2]!)).toEqual([200, 300]); // end.x, midY
    expect(toScene(arrow.points[3]!)).toEqual([200, 480]);
  });

  it('elbow with a raw Point endpoint falls back to the legacy boundary math', () => {
    // Cardinal-port routing needs both ends bound to a record. When one
    // side is a free Point the connector keeps the boundary-based anchor
    // and the |dx| vs |dy| axis fallback so it still produces a sensible
    // L-bend.
    const a: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 100],
      fit: 'fixed',
      size: [80, 40],
      text: 'A',
    };
    const c: Connector = {
      kind: 'connector',
      id: 'c' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: [400, 400],
      routing: 'elbow',
    };
    const result = compile(makeScene([a, c]));
    const arrow = findArrow(result.elements);

    // boundaryPoint picks the box exit on the A→(400,400) vector; we only
    // pin that the arrow has 4 elbow points and ends at the raw target.
    expect(arrow.points.length).toBeGreaterThanOrEqual(2);
    const last = arrow.points[arrow.points.length - 1]!;
    expect(arrow.x + last[0]).toBe(400);
    expect(arrow.y + last[1]).toBe(400);
    expect(arrow.startBinding).not.toBeNull();
    expect(arrow.endBinding).toBeNull();
  });

  it('parallel connectors (bidirectional pair) are offset perpendicular so labels do not collide', () => {
    // Two vertically-stacked rectangles with bidirectional connectors — the
    // regression we observed: both arrows ran on the same line and both
    // labels landed at identical midpoints. After the lane-offset fix the
    // two arrows must sit on distinct parallel lines.
    const a: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 100],
      fit: 'fixed',
      size: [200, 80],
      text: 'A',
    };
    const b: LabelBox = {
      kind: 'labelBox',
      id: 'b' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 300],
      fit: 'fixed',
      size: [200, 80],
      text: 'B',
    };
    const forward: Connector = {
      kind: 'connector',
      id: 'ab' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: 'b' as PrimitiveId,
      label: 'req',
      routing: 'straight',
    };
    const reverse: Connector = {
      kind: 'connector',
      id: 'ba' as PrimitiveId,
      from: 'b' as PrimitiveId,
      to: 'a' as PrimitiveId,
      label: 'res',
      routing: 'straight',
    };
    const result = compile(makeScene([a, b, forward, reverse]));
    const arrows = result.elements.filter(
      (el): el is ExcalidrawArrowElement => el.type === 'arrow',
    );
    expect(arrows).toHaveLength(2);
    // The two arrows must have distinct x origins (perpendicular offset).
    expect(arrows[0]!.x).not.toBe(arrows[1]!.x);

    // Their label midpoints (== arrow midpoint since straight vertical) must
    // also differ, otherwise both labels render on top of each other.
    const labels = result.elements.filter(
      (el) => el.type === 'text' && el.containerId !== undefined,
    );
    const arrowLabels = labels.filter(
      (el) =>
        'containerId' in el &&
        arrows.some((a) => a.id === (el as { containerId?: string }).containerId),
    );
    expect(arrowLabels).toHaveLength(2);
    const labelXs = arrowLabels.map((el) => el.x);
    expect(labelXs[0]).not.toBe(labelXs[1]);
  });

  it('routedPath label anchors on the middle segment, not the endpoint midpoint', () => {
    // Regression for "재시도" / feedback-edge labels floating off-path. A
    // 6-point ELK-routed feedback edge has endpoints far apart horizontally
    // (~200px) but the actual drawn path runs as a narrow L along x≈9.
    // The straight-line midpoint would land at x≈99 in open space; the
    // real edge has no ink there and readers can't tell which arrow the
    // label belongs to. Anchoring on the middle segment (matching
    // Excalidraw 0.17.x's own bound-text logic) keeps the label on the
    // segment that carries the edge.
    const a: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 100],
      fit: 'fixed',
      size: [80, 40],
      text: 'A',
    };
    const b: LabelBox = {
      kind: 'labelBox',
      id: 'b' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 400],
      fit: 'fixed',
      size: [80, 40],
      text: 'B',
    };
    const c: Connector = {
      kind: 'connector',
      id: 'c' as PrimitiveId,
      from: 'b' as PrimitiveId,
      to: 'a' as PrimitiveId,
      label: '재시도',
      routing: 'elbow',
      routedPath: [
        [84, 526],
        [84, 476],
        [93, 476],
        [93, 239],
        [281.83, 239],
        [281.83, 229],
      ],
    };
    const result = compile(makeScene([a, b, c]));
    const label = result.elements.find(
      (el): el is {
        type: 'text';
        text: string;
        x: number;
        y: number;
        width: number;
        height: number;
      } => el.type === 'text' && (el as { text?: string }).text === '재시도',
    );
    if (label === undefined) {
      throw new Error('expected label element');
    }
    const centerX = label.x + label.width / 2;
    const centerY = label.y + label.height / 2;
    // Middle segment of the 6-point path is points[2]→points[3] = (93,476)→(93,239).
    // Midpoint = (93, 357.5). The straight-line midpoint between waypoints[0]
    // and waypoints[5] would be (182.9, 377.5) — off in open space.
    expect(centerX).toBe(93);
    expect(centerY).toBeCloseTo(357.5, 5);
  });

  it('raw Point endpoints are passed through unchanged (no boundary math)', () => {
    const c: Connector = {
      kind: 'connector',
      id: 'c' as PrimitiveId,
      from: [10, 20],
      to: [110, 220],
      routing: 'straight',
    };
    const result = compile(makeScene([c]));
    const arrow = findArrow(result.elements);
    expect(arrow.x).toBe(10);
    expect(arrow.y).toBe(20);
    const lastPoint = arrow.points[arrow.points.length - 1]!;
    expect(arrow.x + lastPoint[0]).toBe(110);
    expect(arrow.y + lastPoint[1]).toBe(220);
    expect(arrow.startBinding).toBeNull();
    expect(arrow.endBinding).toBeNull();
  });
});

describe('emitConnector — straight-line obstacle detour (arch-cdn-03)', () => {
  // Regression: arch-cdn-03 eval rendered a Web→DB "read" arrow as a single
  // vertical straight line at x=250 from (250, 462.5) to (250, 652.5). A
  // Redis Cache node sat between them at x=150-350, y=537.5-602.5, so the
  // arrow — and its bound "read" label pinned to the polyline midpoint —
  // rendered on top of the Redis node's text. The scene carried a Frame,
  // so buildGraphModel returned null and ELK never had a chance to route
  // the edge. The emit layer now detects the crossing and bends around.
  it('vertical straight connector detours around a LabelBox sitting on the same axis', () => {
    const web: LabelBox = {
      kind: 'labelBox',
      id: 'web' as PrimitiveId,
      shape: 'rectangle',
      at: [250, 430],
      fit: 'fixed',
      size: [200, 65],
      text: 'Web',
    };
    const redis: LabelBox = {
      kind: 'labelBox',
      id: 'redis' as PrimitiveId,
      shape: 'rectangle',
      at: [250, 570],
      fit: 'fixed',
      size: [200, 65],
      text: 'Redis',
    };
    const db: LabelBox = {
      kind: 'labelBox',
      id: 'db' as PrimitiveId,
      shape: 'rectangle',
      at: [250, 710],
      fit: 'fixed',
      size: [200, 115],
      text: 'DB',
    };
    const c: Connector = {
      kind: 'connector',
      id: 'c' as PrimitiveId,
      from: 'web' as PrimitiveId,
      to: 'db' as PrimitiveId,
      routing: 'straight',
      label: 'read',
    };
    const result = compile(makeScene([web, redis, db, c]));
    const arrow = findArrow(result.elements);
    // Must bend: a 2-point straight line would cut through Redis.
    expect(arrow.points.length).toBeGreaterThanOrEqual(4);
    // None of the interior waypoints may sit inside Redis's bbox.
    // Redis bbox: x=[150,350], y=[537.5, 602.5].
    for (const [px, py] of arrow.points) {
      const absX = arrow.x + px;
      const absY = arrow.y + py;
      const insideX = absX > 150 && absX < 350;
      const insideY = absY > 537.5 && absY < 602.5;
      expect(insideX && insideY).toBe(false);
    }
  });

  it('does not detour when no obstacle sits on the straight line', () => {
    const a: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 100],
      fit: 'fixed',
      size: [80, 40],
      text: 'A',
    };
    const b: LabelBox = {
      kind: 'labelBox',
      id: 'b' as PrimitiveId,
      shape: 'rectangle',
      at: [300, 100],
      fit: 'fixed',
      size: [80, 40],
      text: 'B',
    };
    const c: Connector = {
      kind: 'connector',
      id: 'c' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: 'b' as PrimitiveId,
      routing: 'straight',
    };
    const result = compile(makeScene([a, b, c]));
    const arrow = findArrow(result.elements);
    // Untouched by the detour: still a simple 2-point straight line.
    expect(arrow.points.length).toBe(2);
  });

  it('diagonal straight connector detours around a LabelBox its line crosses', () => {
    // Regression: arch-cdn-03 re-run rendered "read" edges as diagonal
    // lines from a Web Server node down to a DB Replica node, passing
    // through a Redis Cache node placed in between but offset sideways.
    // The axis-aligned detour missed these; the Liang-Barsky check catches
    // any crossing regardless of orientation.
    const web: LabelBox = {
      kind: 'labelBox',
      id: 'web' as PrimitiveId,
      shape: 'rectangle',
      at: [150, 480],
      fit: 'fixed',
      size: [160, 55],
      text: 'Web',
    };
    const redis: LabelBox = {
      kind: 'labelBox',
      id: 'redis' as PrimitiveId,
      shape: 'rectangle',
      at: [250, 620],
      fit: 'fixed',
      size: [180, 65],
      text: 'Redis',
    };
    const db: LabelBox = {
      kind: 'labelBox',
      id: 'db' as PrimitiveId,
      shape: 'rectangle',
      at: [240, 780],
      fit: 'fixed',
      size: [180, 65],
      text: 'DB',
    };
    const c: Connector = {
      kind: 'connector',
      id: 'c' as PrimitiveId,
      from: 'web' as PrimitiveId,
      to: 'db' as PrimitiveId,
      routing: 'straight',
      label: 'read',
    };
    const result = compile(makeScene([web, redis, db, c]));
    const arrow = findArrow(result.elements);
    // Must bend around Redis.
    expect(arrow.points.length).toBeGreaterThanOrEqual(3);
    // No waypoint may sit strictly inside Redis.
    // Redis bbox: x=[160, 340], y=[587.5, 652.5].
    for (const [px, py] of arrow.points) {
      const absX = arrow.x + px;
      const absY = arrow.y + py;
      const insideX = absX > 160 && absX < 340;
      const insideY = absY > 587.5 && absY < 652.5;
      expect(insideX && insideY).toBe(false);
    }
  });

  it('endpoint-adjacent LabelBoxes (targets of other edges) do not trigger a false detour', () => {
    // "cache" edge Web → Redis must stay straight even though Redis's
    // bbox touches the arrow's end point. `findBlockingLabelBox` excludes
    // the endpoint-owning primitives from the obstacle search.
    const web: LabelBox = {
      kind: 'labelBox',
      id: 'web' as PrimitiveId,
      shape: 'rectangle',
      at: [250, 430],
      fit: 'fixed',
      size: [200, 65],
      text: 'Web',
    };
    const redis: LabelBox = {
      kind: 'labelBox',
      id: 'redis' as PrimitiveId,
      shape: 'rectangle',
      at: [250, 570],
      fit: 'fixed',
      size: [200, 65],
      text: 'Redis',
    };
    const c: Connector = {
      kind: 'connector',
      id: 'c' as PrimitiveId,
      from: 'web' as PrimitiveId,
      to: 'redis' as PrimitiveId,
      routing: 'straight',
    };
    const result = compile(makeScene([web, redis, c]));
    const arrow = findArrow(result.elements);
    expect(arrow.points.length).toBe(2);
  });

  it('edge label is nudged along the edge tangent when it overlaps a neighbouring node', () => {
    // Regression for arch-cdn-03: Web Server A → Read Replica A edge
    // runs vertically past the Redis Cache A box. The polyline midpoint
    // lands just inside the Redis box's right edge, so the "읽기" label
    // clips the node corner. The nudge should slide the label along the
    // tangent (vertical here) so the bbox no longer overlaps the
    // neighbour, even though the neighbour is not an endpoint of the edge.
    const source: LabelBox = {
      kind: 'labelBox',
      id: 'source' as PrimitiveId,
      shape: 'rectangle',
      at: [200, 100],
      fit: 'fixed',
      size: [200, 60],
      text: 'Source',
    };
    const target: LabelBox = {
      kind: 'labelBox',
      id: 'target' as PrimitiveId,
      shape: 'rectangle',
      at: [200, 500],
      fit: 'fixed',
      size: [200, 60],
      text: 'Target',
    };
    // Neighbour parked right where the edge midpoint would land (y=300).
    const neighbour: LabelBox = {
      kind: 'labelBox',
      id: 'neighbour' as PrimitiveId,
      shape: 'rectangle',
      at: [110, 300],
      fit: 'fixed',
      size: [200, 80],
      text: 'Neighbour',
    };
    const edge: Connector = {
      kind: 'connector',
      id: 'edge' as PrimitiveId,
      from: 'source' as PrimitiveId,
      to: 'target' as PrimitiveId,
      label: '읽기',
      routing: 'straight',
    };
    const result = compile(makeScene([source, target, neighbour, edge]));
    const arrowLabel = result.elements.find(
      (el) =>
        el.type === 'text' &&
        (el as { text?: string }).text === '읽기',
    ) as { x: number; y: number; width: number; height: number } | undefined;
    expect(arrowLabel).toBeDefined();
    // Neighbour bbox is x∈[10,210], y∈[260,340]. The label bbox after the
    // nudge must sit clear of that rectangle.
    const lx1 = arrowLabel!.x;
    const ly1 = arrowLabel!.y;
    const lx2 = lx1 + arrowLabel!.width;
    const ly2 = ly1 + arrowLabel!.height;
    const nx1 = 10;
    const ny1 = 260;
    const nx2 = 210;
    const ny2 = 340;
    const overlaps = lx1 < nx2 && lx2 > nx1 && ly1 < ny2 && ly2 > ny1;
    expect(overlaps).toBe(false);
  });
});
