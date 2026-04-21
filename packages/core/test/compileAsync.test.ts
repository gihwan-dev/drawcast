// compileAsync end-to-end: feeds a scene whose coordinates are
// deliberately absurd (every labelBox at (999, 999)) through the
// auto-layout pipeline and verifies the emitted Excalidraw elements
// reflect ELK's positions, not the input noise.

import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile/index.js';
import { compileAsync } from '../src/layout/compileAsync.js';
import { sketchyTheme } from '../src/theme.js';
import type {
  Connector,
  Frame,
  LabelBox,
  Primitive,
  PrimitiveId,
  Scene,
} from '../src/primitives.js';
import type { ExcalidrawRectangleElement } from '../src/types/excalidraw.js';

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
