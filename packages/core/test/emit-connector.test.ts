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
