// Compile pipeline tests. Each case exercises one slice of the contract
// described in docs/03-compile-pipeline.md and the pitfall guards in
// docs/09-pitfalls-and-compliance.md.

import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile/index.js';
import { sketchyTheme } from '../src/theme.js';
import type {
  LabelBox,
  Connector,
  Group,
  Frame,
  Primitive,
  PrimitiveId,
  Scene,
} from '../src/primitives.js';
import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawFrameElement,
  ExcalidrawRectangleElement,
  ExcalidrawTextElement,
  FixedPointBinding,
} from '../src/types/excalidraw.js';

function makeScene(primitives: Primitive[]): Scene {
  return {
    primitives: new Map(primitives.map((p) => [p.id, p])),
    theme: sketchyTheme,
  };
}

function find<T extends ExcalidrawElement>(
  elements: ExcalidrawElement[],
  pred: (el: ExcalidrawElement) => el is T,
): T {
  const found = elements.find(pred);
  if (!found) throw new Error('element not found');
  return found;
}

describe('compile — empty scene', () => {
  it('returns no elements, no warnings, no files', () => {
    const scene = makeScene([]);
    const result = compile(scene);
    expect(result.elements).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.files).toEqual({});
  });
});

describe('compile — LabelBox with text', () => {
  it('emits a shape + bound text with bidirectional boundElements', () => {
    const p: LabelBox = {
      kind: 'labelBox',
      id: 'box1' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 100],
      text: 'Hello',
    };
    const result = compile(makeScene([p]));
    expect(result.warnings).toEqual([]);
    expect(result.elements).toHaveLength(2);

    const rect = find(
      result.elements,
      (el): el is ExcalidrawRectangleElement => el.type === 'rectangle',
    );
    const text = find(
      result.elements,
      (el): el is ExcalidrawTextElement => el.type === 'text',
    );

    // Bidirectional binding (P1 / C4).
    expect(text.containerId).toBe(rect.id);
    expect(rect.boundElements).toContainEqual({ type: 'text', id: text.id });

    // Text is wrapped -> container-bound, so autoResize must be false (P4).
    expect(text.autoResize).toBe(false);
    expect(text.originalText).toBe('Hello');

    // Rectangle sized around the label center (auto fit).
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
});

describe('compile — Connector between two LabelBoxes', () => {
  const boxA: LabelBox = {
    kind: 'labelBox',
    id: 'a' as PrimitiveId,
    shape: 'rectangle',
    at: [100, 100],
    text: 'A',
  };
  const boxB: LabelBox = {
    kind: 'labelBox',
    id: 'b' as PrimitiveId,
    shape: 'rectangle',
    at: [400, 100],
    text: 'B',
  };
  const connector: Connector = {
    kind: 'connector',
    id: 'c' as PrimitiveId,
    from: 'a' as PrimitiveId,
    to: 'b' as PrimitiveId,
  };

  it('produces 4 text/shape elements + 1 arrow with normalized points', () => {
    const result = compile(makeScene([boxA, boxB, connector]));
    expect(result.warnings).toEqual([]);
    // 2 rectangles + 2 texts + 1 arrow
    const arrow = find(
      result.elements,
      (el): el is ExcalidrawArrowElement => el.type === 'arrow',
    );

    // P3 — points[0] must be [0, 0].
    expect(arrow.points[0]).toEqual([0, 0]);
    expect(arrow.points.length).toBeGreaterThanOrEqual(2);

    // Bindings point at the rectangles.
    const rects = result.elements.filter(
      (el): el is ExcalidrawRectangleElement => el.type === 'rectangle',
    );
    expect(rects).toHaveLength(2);
    const [rectA, rectB] = rects;

    expect(arrow.startBinding?.elementId).toBe(rectA!.id);
    expect(arrow.endBinding?.elementId).toBe(rectB!.id);

    // Reverse-side boundElements on each box.
    expect(rectA!.boundElements).toEqual(
      expect.arrayContaining([{ type: 'arrow', id: arrow.id }]),
    );
    expect(rectB!.boundElements).toEqual(
      expect.arrayContaining([{ type: 'arrow', id: arrow.id }]),
    );

    // Straight arrow -> elbowed:false.
    expect(arrow.elbowed).toBe(false);
  });
});

describe('compile — elbow connector (P17)', () => {
  it('produces elbowed arrow with FixedPointBinding fixedPoint off-center', () => {
    const boxA: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 0],
      text: 'A',
    };
    const boxB: LabelBox = {
      kind: 'labelBox',
      id: 'b' as PrimitiveId,
      shape: 'rectangle',
      at: [300, 200],
      text: 'B',
    };
    const c: Connector = {
      kind: 'connector',
      id: 'c' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: 'b' as PrimitiveId,
      routing: 'elbow',
    };
    const result = compile(makeScene([boxA, boxB, c]));
    const arrow = find(
      result.elements,
      (el): el is ExcalidrawArrowElement => el.type === 'arrow',
    );
    expect(arrow.elbowed).toBe(true);

    // Both bindings must be FixedPointBinding (has fixedPoint) — P17.
    const sb = arrow.startBinding as FixedPointBinding;
    const eb = arrow.endBinding as FixedPointBinding;
    expect(sb.fixedPoint).toEqual([0.4999, 0.5001]);
    expect(eb.fixedPoint).toEqual([0.4999, 0.5001]);

    // Must NOT be the oscillation-prone exact center.
    expect(sb.fixedPoint[0]).not.toBe(0.5);
    expect(sb.fixedPoint[1]).not.toBe(0.5);
  });
});

describe('compile — Group (P7)', () => {
  it('pushes groupId onto every child element', () => {
    const boxA: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 0],
      text: 'A',
    };
    const boxB: LabelBox = {
      kind: 'labelBox',
      id: 'b' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 0],
      text: 'B',
    };
    const grp: Group = {
      kind: 'group',
      id: 'g' as PrimitiveId,
      children: ['a' as PrimitiveId, 'b' as PrimitiveId],
    };
    const result = compile(makeScene([boxA, boxB, grp]));
    expect(result.warnings).toEqual([]);
    // Every emitted element from the grouped primitives should carry 'g'.
    const grouped = result.elements.filter((el) => el.groupIds.includes('g'));
    expect(grouped).toHaveLength(4); // 2 rects + 2 text children
  });
});

describe('compile — Frame (P8 / C7)', () => {
  it('sets frameId on every child element', () => {
    const boxA: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [50, 50],
      text: 'A',
    };
    const frame: Frame = {
      kind: 'frame',
      id: 'f' as PrimitiveId,
      at: [0, 0],
      size: [200, 200],
      children: ['a' as PrimitiveId],
    };
    const result = compile(makeScene([boxA, frame]));
    expect(result.warnings).toEqual([]);
    const frameEl = find(
      result.elements,
      (el): el is ExcalidrawFrameElement => el.type === 'frame',
    );
    const children = result.elements.filter((el) => el.id !== frameEl.id);
    for (const child of children) {
      expect(child.frameId).toBe(frameEl.id);
    }
  });
});

describe('compile — warnings', () => {
  it('Group referencing unknown child produces MISSING_CHILD warning', () => {
    const grp: Group = {
      kind: 'group',
      id: 'g' as PrimitiveId,
      children: ['doesNotExist' as PrimitiveId],
    };
    const result = compile(makeScene([grp]));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('MISSING_CHILD');
  });

  it('Unknown style preset falls back to default and warns', () => {
    const p: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 0],
      text: 'x',
      style: 'nonexistent-preset',
    };
    const result = compile(makeScene([p]));
    const warning = result.warnings.find(
      (w) => w.code === 'STYLE_PRESET_MISSING',
    );
    expect(warning).toBeDefined();
    // Emit proceeded with fallback — elements are still generated.
    const rect = result.elements.find((el) => el.type === 'rectangle');
    expect(rect).toBeDefined();
  });
});

describe('compile — customData.drawcastPrimitiveId', () => {
  it('tags every emitted element with its owning primitive id', () => {
    const box: LabelBox = {
      kind: 'labelBox',
      id: 'box-1' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 0],
      text: 'Hi',
    };
    const arrow: Connector = {
      kind: 'connector',
      id: 'arrow-1' as PrimitiveId,
      from: [0, 0],
      to: [100, 100],
      label: 'goes',
    };
    const result = compile(makeScene([box, arrow]));
    // Both LabelBox children (shape + text) carry box-1.
    const boxElements = result.elements.filter(
      (el) =>
        (el.customData as { drawcastPrimitiveId?: string })
          ?.drawcastPrimitiveId === 'box-1',
    );
    expect(boxElements.length).toBe(2);
    // Connector arrow + label text both carry arrow-1.
    const arrowElements = result.elements.filter(
      (el) =>
        (el.customData as { drawcastPrimitiveId?: string })
          ?.drawcastPrimitiveId === 'arrow-1',
    );
    expect(arrowElements.length).toBe(2);
    // Every element has a drawcastPrimitiveId.
    for (const el of result.elements) {
      const cd = el.customData as
        | { drawcastPrimitiveId?: string }
        | undefined;
      expect(cd?.drawcastPrimitiveId).toBeDefined();
    }
  });

  it('preserves user-supplied customData keys on the primitive', () => {
    const box: LabelBox = {
      kind: 'labelBox',
      id: 'boxA' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 0],
      text: 'x',
      customData: { owner: 'alice', tag: 42 },
    };
    const result = compile(makeScene([box]));
    const shape = result.elements.find((el) => el.type === 'rectangle');
    expect(shape).toBeDefined();
    expect(shape!.customData).toEqual({
      owner: 'alice',
      tag: 42,
      drawcastPrimitiveId: 'boxA',
    });
  });
});
