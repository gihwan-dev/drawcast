// Connector endpoint-anchoring regression tests.
//
// Without this guard the emitter put arrow endpoints at the shape centres,
// which visually reads as "the arrow pierces the box". The emitter now
// intersects the ray between the two centres with each source/target
// bounding box, so the arrow starts on the near edge and ends on the far
// edge — matching user expectation and Excalidraw's own "connect two
// shapes" behaviour. Bindings are retained so Excalidraw still auto-
// re-anchors on drag.

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
  it('horizontal pair: arrow starts at source right edge, ends at target left edge', () => {
    // A centred at (100,100), fixed 80x40 → right edge x = 140
    // B centred at (300,100), fixed 80x40 → left  edge x = 260
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

    // arrow.x (= start absolute x) should hug A's right edge, not its centre.
    expect(arrow.x).toBeGreaterThan(135);
    expect(arrow.x).toBeLessThanOrEqual(141);

    // End absolute x = arrow.x + last point dx should hug B's left edge.
    const lastPoint = arrow.points[arrow.points.length - 1]!;
    const endX = arrow.x + lastPoint[0];
    expect(endX).toBeGreaterThanOrEqual(259);
    expect(endX).toBeLessThan(265);
  });

  it('vertical pair: arrow starts at source bottom edge, ends at target top edge', () => {
    // A (100,100) 80x40 → bottom edge y = 120
    // B (100,300) 80x40 → top    edge y = 280
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

    expect(arrow.y).toBeGreaterThan(115);
    expect(arrow.y).toBeLessThanOrEqual(121);

    const lastPoint = arrow.points[arrow.points.length - 1]!;
    const endY = arrow.y + lastPoint[1];
    expect(endY).toBeGreaterThanOrEqual(279);
    expect(endY).toBeLessThan(285);
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
