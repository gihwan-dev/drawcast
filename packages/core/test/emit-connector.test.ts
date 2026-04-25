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
    // Regression for "재시도" / feedback-edge labels floating off-path.
    // The ELK-routed feedback edge comes in as 6 points with a 9px
    // horizontal jog between two parallel verticals; tiny-jog merging
    // collapses it to a clean 4-point L ([84,526]→[84,239]→[281.83,239]
    // →[281.83,229]) whose middle segment is the long horizontal at
    // y=239. The label must land on that visible segment, NOT on the
    // straight-line midpoint (182.9, 377.5) between the endpoints —
    // which falls off every segment of the simplified path.
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
    // After tiny-jog merging the path would be [[84,526], [84,239],
    // [281.83,239], [281.83,229]] — but the last V-leg is only 10px so
    // the rebalance pass shifts the horizontal to the midpoint Y=377.5.
    // The middle segment (points[1]→points[2]) is the horizontal at
    // y=377.5, midpoint (182.915, 377.5). Both axes stay on the visible
    // edge and the label sits midway between source and target.
    expect(centerX).toBeCloseTo(182.915, 5);
    expect(centerY).toBeCloseTo(377.5, 5);
  });

  it('collapses tiny ELK routedPath jogs into an L-shape', () => {
    // Direct coverage for the flow-login-01 regression: a 6-point retry
    // edge with a 9px horizontal jog at y=476 should emit as 4 points
    // after simplification (one clean L via the left column). The path
    // starts at the left edge of the source box and ends on the bottom
    // of the target box; no obstacle sits on the shifted column so the
    // via-A candidate is chosen.
    const source: LabelBox = {
      kind: 'labelBox',
      id: 'src' as PrimitiveId,
      shape: 'rectangle',
      at: [140, 530],
      fit: 'fixed',
      size: [120, 40],
      text: 'SRC',
    };
    const target: LabelBox = {
      kind: 'labelBox',
      id: 'tgt' as PrimitiveId,
      shape: 'rectangle',
      at: [300, 200],
      fit: 'fixed',
      size: [240, 60],
      text: 'TGT',
    };
    const retry: Connector = {
      kind: 'connector',
      id: 'retry' as PrimitiveId,
      from: 'src' as PrimitiveId,
      to: 'tgt' as PrimitiveId,
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
    const result = compile(makeScene([source, target, retry]));
    const arrow = result.elements.find(
      (el): el is { type: 'arrow'; x: number; y: number; points: number[][] } =>
        el.type === 'arrow',
    );
    if (arrow === undefined) throw new Error('expected arrow element');
    // 4 points: start, one bend, horizontal landing, arrowhead.
    expect(arrow.points).toHaveLength(4);
    // Start and end preserved so the bindings still land on the bound shapes.
    const absolute = arrow.points.map((pt) => [arrow.x + pt[0], arrow.y + pt[1]]);
    expect(absolute[0]).toEqual([84, 526]);
    expect(absolute[3]).toEqual([281.83, 229]);
    // Intermediate corners snap to A's column (x=84) / D's column (x=281.83).
    // The Y of the horizontal is mid-way between source and target (not
    // pinned to y=239 near the target) because tiny-jog merging left a
    // 10px last-V-leg that the rebalance pass pulled to midY=377.5.
    const midY = (526 + 229) / 2;
    expect(absolute[1]).toEqual([84, midY]);
    expect(absolute[2]).toEqual([281.83, midY]);
  });

  it('rebalances uneven V-H-V routedPath so the label sits between source and target', () => {
    // flow-login-01 "성공" regression: ELK routes the success branch
    // off the diamond's bottom-middle with a 10-182-135 leg split. The
    // tiny first stub puts the horizontal (and its bound label) right
    // under the decision node instead of midway toward the success box.
    // The rebalance pass moves the horizontal to mid-Y so the two
    // vertical legs become equal.
    const diamond: LabelBox = {
      kind: 'labelBox',
      id: 'diamond' as PrimitiveId,
      shape: 'diamond',
      at: [235, 289],
      fit: 'fixed',
      size: [119, 92],
      text: 'Q',
    };
    const success: LabelBox = {
      kind: 'labelBox',
      id: 'success' as PrimitiveId,
      shape: 'rectangle',
      at: [30, 526],
      fit: 'fixed',
      size: [160, 60],
      text: 'OK',
    };
    const edge: Connector = {
      kind: 'connector',
      id: 'edge' as PrimitiveId,
      from: 'diamond' as PrimitiveId,
      to: 'success' as PrimitiveId,
      routing: 'elbow',
      routedPath: [
        [295, 381],
        [295, 391],
        [110, 391],
        [110, 526],
      ],
    };
    const result = compile(makeScene([diamond, success, edge]));
    const arrow = findArrow(result.elements);
    expect(arrow.points).toHaveLength(4);
    const absolute = arrow.points.map((pt) => [arrow.x + pt[0], arrow.y + pt[1]]);
    // Endpoints preserved — bindings still land on their shapes.
    expect(absolute[0]).toEqual([295, 381]);
    expect(absolute[3]).toEqual([110, 526]);
    // Crossing moved to the midpoint Y so the horizontal leg centres
    // the bound label between source and target.
    const midY = (381 + 526) / 2;
    expect(absolute[1]).toEqual([295, midY]);
    expect(absolute[2]).toEqual([110, midY]);
  });

  it('leaves a balanced V-H-V routedPath alone', () => {
    // Guard against over-eager rebalancing: when ELK already produces a
    // symmetric L-bend (both vertical legs longer than TINY_JOG_LENGTH)
    // the output should pass through unchanged.
    const source: LabelBox = {
      kind: 'labelBox',
      id: 'src' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 100],
      fit: 'fixed',
      size: [80, 40],
      text: 'A',
    };
    const target: LabelBox = {
      kind: 'labelBox',
      id: 'tgt' as PrimitiveId,
      shape: 'rectangle',
      at: [300, 300],
      fit: 'fixed',
      size: [80, 40],
      text: 'B',
    };
    const edge: Connector = {
      kind: 'connector',
      id: 'edge' as PrimitiveId,
      from: 'src' as PrimitiveId,
      to: 'tgt' as PrimitiveId,
      routing: 'elbow',
      routedPath: [
        [140, 140],
        [140, 220],
        [340, 220],
        [340, 300],
      ],
    };
    const result = compile(makeScene([source, target, edge]));
    const arrow = findArrow(result.elements);
    const absolute = arrow.points.map((pt) => [arrow.x + pt[0], arrow.y + pt[1]]);
    expect(absolute).toEqual([
      [140, 140],
      [140, 220],
      [340, 220],
      [340, 300],
    ]);
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

  it('line-shaped LabelBoxes (sequence-diagram lifelines) do not trigger detours', () => {
    // Regression: seq-llm-05 emitted vertical "lifeline" rectangles at
    // width=2 between participant boxes, then horizontal sequence messages
    // crossing those lifelines. The detour treated each lifeline as an
    // obstacle, sending every horizontal arrow up to the same y-coordinate
    // and stacking the bound labels on top of one another (4 label
    // overlaps in a single scene). Lifelines are visual lines, not enclosed
    // regions; sequence messages are MEANT to cross them.
    const userBox: LabelBox = {
      kind: 'labelBox',
      id: 'user' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 40],
      fit: 'fixed',
      size: [150, 60],
      text: 'User',
    };
    const apiBox: LabelBox = {
      kind: 'labelBox',
      id: 'api' as PrimitiveId,
      shape: 'rectangle',
      at: [330, 40],
      fit: 'fixed',
      size: [150, 60],
      text: 'API',
    };
    const dbBox: LabelBox = {
      kind: 'labelBox',
      id: 'db' as PrimitiveId,
      shape: 'rectangle',
      at: [580, 40],
      fit: 'fixed',
      size: [150, 60],
      text: 'DB',
    };
    // Lifelines: tall thin rectangles (width 2) under each participant.
    const userLine: LabelBox = {
      kind: 'labelBox',
      id: 'l_user' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 450],
      fit: 'fixed',
      size: [2, 720],
      text: '',
    };
    const apiLine: LabelBox = {
      kind: 'labelBox',
      id: 'l_api' as PrimitiveId,
      shape: 'rectangle',
      at: [330, 450],
      fit: 'fixed',
      size: [2, 720],
      text: '',
    };
    const dbLine: LabelBox = {
      kind: 'labelBox',
      id: 'l_db' as PrimitiveId,
      shape: 'rectangle',
      at: [580, 450],
      fit: 'fixed',
      size: [2, 720],
      text: '',
    };
    // Horizontal sequence message User → API at y=160. The straight line
    // crosses the User lifeline endpoint and grazes the API lifeline.
    const msg: Connector = {
      kind: 'connector',
      id: 'm1' as PrimitiveId,
      from: [100, 160],
      to: [330, 160],
      routing: 'straight',
      label: 'request',
    };
    const result = compile(
      makeScene([userBox, apiBox, dbBox, userLine, apiLine, dbLine, msg]),
    );
    const arrow = findArrow(result.elements);
    // Must remain a 2-point straight line — no detour around the lifelines.
    expect(arrow.points.length).toBe(2);
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

  it('CJK bound label bbox carries a width buffer so Excalidraw does not wrap it', () => {
    // flow-login-01 "재시도": the default Excalidraw fonts ship no Hangul
    // glyphs, so Excalidraw's runtime `refreshTextDimensions` measures
    // the label slightly wider than our static `measureText` estimate.
    // With a flush bbox the runtime wraps the 3-char label into three
    // single-character lines that render as a vertically-stacked column.
    // The emitter must pad the CJK label bbox so the runtime never
    // wraps. Latin labels of matching codepoint count stay flush because
    // their glyphs render in the authored Excalidraw font.
    const a: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 100],
      fit: 'fixed',
      size: [120, 40],
      text: 'A',
    };
    const b: LabelBox = {
      kind: 'labelBox',
      id: 'b' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 300],
      fit: 'fixed',
      size: [120, 40],
      text: 'B',
    };
    const korean: Connector = {
      kind: 'connector',
      id: 'c-kor' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: 'b' as PrimitiveId,
      label: '재시도',
    };
    const latin: Connector = {
      kind: 'connector',
      id: 'c-lat' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: 'b' as PrimitiveId,
      label: 'RET',
    };
    const korResult = compile(makeScene([a, b, korean]));
    const latResult = compile(makeScene([a, b, latin]));
    const korLabel = korResult.elements.find(
      (el) => el.type === 'text' && (el as { text?: string }).text === '재시도',
    ) as { width: number } | undefined;
    const latLabel = latResult.elements.find(
      (el) => el.type === 'text' && (el as { text?: string }).text === 'RET',
    ) as { width: number } | undefined;
    expect(korLabel).toBeDefined();
    expect(latLabel).toBeDefined();
    // "재시도" measures as 3 CJK chars × 2 visual units × 0.55 × 20 = 66px.
    // The CJK padding must round up to at least 6px so the bbox clears the
    // runtime overshoot; anything smaller risks the single-character wrap.
    expect(korLabel!.width).toBeGreaterThanOrEqual(66 + 6);
    // Latin labels stay tight against `measureText` (no fallback overshoot).
    expect(latLabel!.width).toBeLessThan(66);
  });
});

describe('passRelational — clearEdgeLabelsFromOtherArrows post-pass', () => {
  // flow-ci-04 regression: multiple "실패" edges share a narrow vertical
  // corridor and a main-flow vertical arrow stems through where their bound
  // labels anchor (the middle-segment midpoint of each H-V-H feedback
  // polyline). Excalidraw recomputes bound-text positions from the arrow
  // polyline at render time, so the fix has to move the *arrow* — the
  // post-pass shifts the 4-point arrow's middle segment perpendicular until
  // the label bbox clears every non-own polyline.
  //
  // Geometry for this test:
  //   A (100,100..180,140) — right-centre (180, 120)
  //   B (400,260..480,300) — left-centre  (400, 280)
  //   C (240, 20..320, 60) — bottom-centre (280,  60)
  //   D (240,340..320,380) — top-centre   (280, 380)
  //   E1 A→B H-V-H via X=280 with label "L"; label anchor = (280, 200)
  //   E2 C→D vertical at X=280
  // The vertical polyline of E2 passes straight through E1's bound-label
  // bbox, so the post-pass must shift E1's middle segment in X.
  it('shifts a 4-point H-V-H arrow whose bound label sits on another arrow', () => {
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
      at: [400, 260],
      fit: 'fixed',
      size: [80, 40],
      text: 'B',
    };
    const c: LabelBox = {
      kind: 'labelBox',
      id: 'c' as PrimitiveId,
      shape: 'rectangle',
      at: [240, 20],
      fit: 'fixed',
      size: [80, 40],
      text: 'C',
    };
    const d: LabelBox = {
      kind: 'labelBox',
      id: 'd' as PrimitiveId,
      shape: 'rectangle',
      at: [240, 340],
      fit: 'fixed',
      size: [80, 40],
      text: 'D',
    };
    const e1: Connector = {
      kind: 'connector',
      id: 'e1' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: 'b' as PrimitiveId,
      label: 'L',
      routing: 'elbow',
      routedPath: [
        [180, 120],
        [280, 120],
        [280, 280],
        [400, 280],
      ],
    };
    const e2: Connector = {
      kind: 'connector',
      id: 'e2' as PrimitiveId,
      from: 'c' as PrimitiveId,
      to: 'd' as PrimitiveId,
      routing: 'elbow',
      routedPath: [
        [280, 60],
        [280, 340],
      ],
    };

    const result = compile(makeScene([a, b, c, d, e1, e2]));
    const arrows = result.elements.filter(
      (el): el is ExcalidrawArrowElement => el.type === 'arrow',
    );
    const e1Arrow = arrows.find(
      (ar) => ar.boundElements?.some((be) => be.type === 'text'),
    );
    if (e1Arrow === undefined) throw new Error('expected labelled arrow');

    expect(e1Arrow.points).toHaveLength(4);
    const abs = e1Arrow.points.map(
      (pt) => [e1Arrow.x + pt[0], e1Arrow.y + pt[1]] as [number, number],
    );
    // Endpoints still anchored to A's right edge and B's left edge.
    expect(abs[0]).toEqual([180, 120]);
    expect(abs[3]).toEqual([400, 280]);
    // Middle segment was shifted OFF the crowded X=280 corridor — the
    // smallest candidate shift (±30) already clears the E2 polyline, so the
    // new vertical lives at X=310 (the rollback would leave it at 280).
    expect(abs[1]![0]).not.toBe(280);
    expect(abs[2]![0]).not.toBe(280);
    expect(abs[1]![0]).toBe(abs[2]![0]);
    expect(abs[1]![1]).toBe(120);
    expect(abs[2]![1]).toBe(280);

    // Excalidraw recomputes the bound-label position at render time from the
    // arrow polyline's middle-segment midpoint, so what actually clears the
    // E2 corridor is the SHIFTED middle-segment X — checked above. (The
    // text element's stored x/y remain at the pre-shift emit position,
    // because only the arrow has to move for the runtime anchor to shift.)
    const newMidX = (abs[1]![0] + abs[2]![0]) / 2;
    expect(Math.abs(newMidX - 280)).toBeGreaterThanOrEqual(30);
  });

  it('leaves a 4-point arrow alone when its label is not crossed by any other arrow', () => {
    // Guard: the post-pass must only fire on confirmed overlaps. A solo
    // H-V-H connector whose label bbox is clear of every sibling polyline
    // should pass through untouched so that routine compiles do not acquire
    // spurious perpendicular nudges.
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
      at: [400, 260],
      fit: 'fixed',
      size: [80, 40],
      text: 'B',
    };
    const e1: Connector = {
      kind: 'connector',
      id: 'e1' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: 'b' as PrimitiveId,
      label: 'L',
      routing: 'elbow',
      routedPath: [
        [180, 120],
        [280, 120],
        [280, 280],
        [400, 280],
      ],
    };

    const result = compile(makeScene([a, b, e1]));
    const arrow = findArrow(result.elements);
    const abs = arrow.points.map(
      (pt) => [arrow.x + pt[0], arrow.y + pt[1]] as [number, number],
    );
    expect(abs).toEqual([
      [180, 120],
      [280, 120],
      [280, 280],
      [400, 280],
    ]);
  });
});
