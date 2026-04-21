// compileAsync end-to-end: feeds a scene whose coordinates are
// deliberately absurd (every labelBox at (999, 999)) through the
// auto-layout pipeline and verifies the emitted Excalidraw elements
// reflect ELK's positions, not the input noise.

import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile/index.js';
import { compileAsync } from '../src/layout/compileAsync.js';
import { measureText } from '../src/measure.js';
import { wrapText } from '../src/wrap.js';
import { sketchyTheme } from '../src/theme.js';
import type {
  Connector,
  Frame,
  LabelBox,
  Primitive,
  PrimitiveId,
  Scene,
} from '../src/primitives.js';
import type {
  ExcalidrawDiamondElement,
  ExcalidrawEllipseElement,
  ExcalidrawRectangleElement,
  ExcalidrawTextElement,
} from '../src/types/excalidraw.js';

function makeScene(primitives: Primitive[]): Scene {
  return {
    primitives: new Map(primitives.map((p) => [p.id, p])),
    theme: sketchyTheme,
  };
}

function box(id: string, at: readonly [number, number] = [999, 999]): LabelBox {
  return {
    kind: 'labelBox',
    id: id as PrimitiveId,
    shape: 'rectangle',
    at,
    fit: 'fixed',
    size: [120, 60],
    text: id.toUpperCase(),
  };
}

function edge(id: string, from: string, to: string): Connector {
  return {
    kind: 'connector',
    id: id as PrimitiveId,
    from: from as PrimitiveId,
    to: to as PrimitiveId,
  };
}

describe('compileAsync', () => {
  it('falls back to compile() when useLayout is false', async () => {
    const scene = makeScene([box('a'), box('b'), edge('c', 'a', 'b')]);
    const sync = compile(scene);
    const async = await compileAsync(scene, { useLayout: false });
    expect(async.elements.length).toBe(sync.elements.length);
    // The sync path honours the input coordinates verbatim.
    const syncRect = sync.elements.find(
      (el): el is ExcalidrawRectangleElement => el.type === 'rectangle',
    );
    const asyncRect = async.elements.find(
      (el): el is ExcalidrawRectangleElement => el.type === 'rectangle',
    );
    expect(asyncRect?.x).toBe(syncRect?.x);
  });

  it('relocates labelBoxes when useLayout=true, independent of input at', async () => {
    // Input puts both boxes on top of each other at (999, 999) — a
    // configuration the legacy compile would render with full overlap.
    const scene = makeScene([box('a'), box('b'), edge('c', 'a', 'b')]);
    const result = await compileAsync(scene, { useLayout: true });
    const rects = result.elements.filter(
      (el): el is ExcalidrawRectangleElement => el.type === 'rectangle',
    );
    expect(rects).toHaveLength(2);
    // ELK's layered algorithm starts near the origin; both boxes should
    // land far from the poisoned input coordinate.
    const [first, second] = rects;
    expect(Math.abs(first!.x - 999)).toBeGreaterThan(100);
    expect(Math.abs(second!.x - 999)).toBeGreaterThan(100);
    // And they should no longer overlap (ELK spacing.nodeNode=60).
    const overlap =
      first!.x < second!.x + second!.width &&
      first!.x + first!.width > second!.x &&
      first!.y < second!.y + second!.height &&
      first!.y + first!.height > second!.y;
    expect(overlap).toBe(false);
  });

  it('is deterministic when called twice with the same scene', async () => {
    const scene = makeScene([
      box('a', [0, 0]),
      box('b', [0, 0]),
      box('c', [0, 0]),
      edge('e1', 'a', 'b'),
      edge('e2', 'b', 'c'),
    ]);
    const [first, second] = await Promise.all([
      compileAsync(scene, { useLayout: true }),
      compileAsync(scene, { useLayout: true }),
    ]);
    const firstRects = first.elements
      .filter((el): el is ExcalidrawRectangleElement => el.type === 'rectangle')
      .map((r) => ({ id: r.id, x: r.x, y: r.y }));
    const secondRects = second.elements
      .filter((el): el is ExcalidrawRectangleElement => el.type === 'rectangle')
      .map((r) => ({ id: r.id, x: r.x, y: r.y }));
    // Element ids are random per compile; compare sets of (x, y).
    const firstCoords = firstRects.map((r) => `${r.x},${r.y}`).sort();
    const secondCoords = secondRects.map((r) => `${r.x},${r.y}`).sort();
    expect(firstCoords).toEqual(secondCoords);
  });

  it('skips layout when the scene contains a frame (Phase 2 scope)', async () => {
    const frame: Frame = {
      kind: 'frame',
      id: 'f' as PrimitiveId,
      at: [10, 10],
      size: [500, 300],
      children: ['a' as PrimitiveId, 'b' as PrimitiveId],
    };
    const scene = makeScene([
      frame,
      box('a', [20, 20]),
      box('b', [200, 20]),
      edge('c', 'a', 'b'),
    ]);
    const sync = compile(scene);
    const async = await compileAsync(scene, { useLayout: true });
    // Frame triggers the skip path, so element coordinates must match
    // the synchronous emit exactly.
    const syncXs = sync.elements
      .filter((el): el is ExcalidrawRectangleElement => el.type === 'rectangle')
      .map((el) => el.x)
      .sort();
    const asyncXs = async.elements
      .filter((el): el is ExcalidrawRectangleElement => el.type === 'rectangle')
      .map((el) => el.x)
      .sort();
    expect(asyncXs).toEqual(syncXs);
  });

  // --- #36 regression: labelBox text must fit inside its container -----------
  //
  // The emit layer sizes text using:
  //   maxTextWidth = shape.width - 2 * padding   (padding = 20)
  //   wrapped      = wrapText(text, maxTextWidth, fontSize, fontFamily)
  //   wrappedMetrics = measureText(wrapped)
  // and then *clamps* text.width/height to shape.width/height. That clamp
  // is what made the pre-fix overflow invisible to a naive bbox check —
  // the text element's own bbox was fine, but the glyphs rendered at
  // wrappedMetrics dimensions, which was wider/taller than the shape.
  //
  // So the real invariant is: measuring the wrapped text must produce
  // a box that fits inside the shape's content area (shape size minus
  // the 20px padding each side). For ellipse/diamond the glyph run has
  // to fit inside the inscribed rectangle (shape / √2) — otherwise the
  // corners/edges of the curve clip the text.
  type LabelBoxCase = {
    name: string;
    text: string;
    shape: LabelBox['shape'];
  };

  const OVERFLOW_CASES: readonly LabelBoxCase[] = [
    // The exact labels from #36's screenshot — Korean multi-line was the
    // reproducer that ELK's 160×60 default couldn't hold.
    { name: 'korean-rect-wide', text: '이메일 / 비밀번호 입력', shape: 'rectangle' },
    { name: 'korean-diamond', text: '입력값 검증', shape: 'diamond' },
    { name: 'korean-diamond-long', text: '인증 성공?', shape: 'diamond' },
    { name: 'korean-ellipse-short', text: '시작', shape: 'ellipse' },
    { name: 'korean-ellipse-long', text: '종료 상태 확인', shape: 'ellipse' },
    { name: 'korean-rect-multiline', text: '오류 메시지\n표시', shape: 'rectangle' },
    // Not Korean — guard against regressing for other scripts too.
    { name: 'english-long', text: 'Authenticate via OAuth2', shape: 'rectangle' },
    { name: 'english-ellipse', text: 'Start', shape: 'ellipse' },
    { name: 'english-diamond', text: 'Valid?', shape: 'diamond' },
  ];

  const INSCRIBED_SHAPES = new Set<LabelBox['shape']>(['ellipse', 'diamond']);
  const EMIT_PADDING = 20; // emit/labelBox.ts DEFAULT_PADDING

  function findShapeFor(
    result: { elements: readonly unknown[] },
    primitiveId: string,
  ): ExcalidrawRectangleElement | ExcalidrawEllipseElement | ExcalidrawDiamondElement {
    const shape = (result.elements as Array<Record<string, unknown>>).find(
      (el) =>
        (el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond') &&
        (el.customData as { drawcastPrimitiveId?: string } | undefined)
          ?.drawcastPrimitiveId === primitiveId,
    );
    if (shape === undefined) {
      throw new Error(`no shape emitted for primitive ${primitiveId}`);
    }
    return shape as
      | ExcalidrawRectangleElement
      | ExcalidrawEllipseElement
      | ExcalidrawDiamondElement;
  }

  function findTextFor(
    result: { elements: readonly unknown[] },
    shapeId: string,
  ): ExcalidrawTextElement {
    const text = (result.elements as Array<Record<string, unknown>>).find(
      (el) => el.type === 'text' && el.containerId === shapeId,
    );
    if (text === undefined) {
      throw new Error(`no bound text for shape ${shapeId}`);
    }
    return text as ExcalidrawTextElement;
  }

  it.each(OVERFLOW_CASES)(
    'emitted text fits inside the shape for $name ($shape)',
    async ({ text, shape }) => {
      // Scene deliberately omits `at` and `size` — the exact Phase 2
      // hybrid contract that triggered #36. Two boxes + an edge so ELK
      // has a real layout to compute, not a single-node no-op.
      const target: LabelBox = {
        kind: 'labelBox',
        id: 'target' as PrimitiveId,
        shape,
        text,
      };
      const neighbour: LabelBox = {
        kind: 'labelBox',
        id: 'neighbour' as PrimitiveId,
        shape: 'rectangle',
        text: 'x',
      };
      const link: Connector = {
        kind: 'connector',
        id: 'e1' as PrimitiveId,
        from: 'target' as PrimitiveId,
        to: 'neighbour' as PrimitiveId,
      };

      const result = await compileAsync(makeScene([target, neighbour, link]), {
        useLayout: true,
      });

      const shapeEl = findShapeFor(result, target.id);
      const textEl = findTextFor(result, shapeEl.id);

      // Replay the emit layer's wrap/measure contract so we see what the
      // renderer will actually paint, not the clamped `textEl.width/height`.
      const fontSize = sketchyTheme.defaultFontSize;
      const fontFamily = sketchyTheme.defaultFontFamily;
      const maxTextWidth = Math.max(shapeEl.width - EMIT_PADDING * 2, 1);
      const wrapped = wrapText({ text, maxWidth: maxTextWidth, fontSize, fontFamily });
      const metrics = measureText({ text: wrapped, fontSize, fontFamily });

      // Sanity: emit really did bind text to this shape.
      expect(textEl.containerId).toBe(shapeEl.id);

      // Invariant 1: glyph run width/height fit inside the shape minus
      // padding. This is what the #36 screenshot showed as "text bleeds
      // past the rectangle / diamond corners".
      expect(metrics.width).toBeLessThanOrEqual(shapeEl.width - EMIT_PADDING * 2);
      expect(metrics.height).toBeLessThanOrEqual(shapeEl.height - EMIT_PADDING * 2);

      // Invariant 2: ellipse/diamond need the content area inside the
      // *inscribed rectangle*, not the bounding box. The inscribed rect
      // of an axis-aligned ellipse/diamond with bbox (W, H) has width
      // W/√2, height H/√2. If the shape bbox exists but its inscribed
      // rect is smaller than the padded glyph run, corners still clip.
      if (INSCRIBED_SHAPES.has(shape)) {
        const inscribedW = shapeEl.width / Math.SQRT2;
        const inscribedH = shapeEl.height / Math.SQRT2;
        expect(metrics.width + EMIT_PADDING * 2).toBeLessThanOrEqual(inscribedW + 1);
        expect(metrics.height + EMIT_PADDING * 2).toBeLessThanOrEqual(inscribedH + 1);
      }
    },
  );

  it('falls back to compile() for a scene with no labelBoxes', async () => {
    // Only a stray connector, no nodes: graph has zero children and we
    // must preserve the caller's primitives untouched.
    const lone = {
      kind: 'connector' as const,
      id: 'c' as PrimitiveId,
      from: [0, 0] as readonly [number, number],
      to: [100, 100] as readonly [number, number],
    };
    const scene = makeScene([lone]);
    const sync = compile(scene);
    const async = await compileAsync(scene, { useLayout: true });
    expect(async.elements.length).toBe(sync.elements.length);
  });
});
