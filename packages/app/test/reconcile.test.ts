// PR #20 reconciler tests.
//
// The reconciler stabilises Excalidraw element identity across successive
// `compile()` calls so the canvas keeps the same element ids (and associated
// undo history) when the MCP server pushes a new scene snapshot.
//
// These cases exercise the four scenarios called out in the PR plan:
//   1. No prior frame → fresh elements pass through unchanged.
//   2. Same primitive id + type → id / seed / version / versionNonce copied
//      from the prior element onto the fresh one.
//   3. Same primitive id but different type → NOT copied (compound
//      primitives like LabelBox emit both a rectangle and a text element
//      per primitive; each slot must stay distinct).
//   4. A new primitive (no prior match) → keeps its fresh id.

import { describe, expect, it } from 'vitest';
import { baseElementFields } from '@drawcast/core';
import type { ExcalidrawElement } from '@drawcast/core';
import { reconcileElements } from '../src/mcp/reconcile.js';

function make(
  primitiveId: string,
  type: 'rectangle' | 'text' | 'arrow',
  overrides: Partial<ExcalidrawElement> = {},
): ExcalidrawElement {
  const base = baseElementFields({
    type,
    customData: { drawcastPrimitiveId: primitiveId },
    ...overrides,
  });
  return base as unknown as ExcalidrawElement;
}

describe('reconcileElements', () => {
  it('passes fresh elements through when there is no previous frame', () => {
    const fresh = [make('p1', 'rectangle'), make('p1', 'text')];
    const result = reconcileElements({ prev: null, fresh, files: {} });
    expect(result.elements.length).toBe(2);
    expect(result.elements[0]!.id).toBe(fresh[0]!.id);
    expect(result.elements[1]!.id).toBe(fresh[1]!.id);
    // Must produce a fresh array, not reuse the input reference.
    expect(result.elements).not.toBe(fresh);
  });

  it('copies id / seed / version / versionNonce when primitive + type match', () => {
    const prev = [
      make('p1', 'rectangle', {
        id: 'stable-id-1',
        seed: 111,
        version: 7,
        versionNonce: 222,
      }),
    ];
    const fresh = [
      make('p1', 'rectangle', {
        id: 'fresh-id-1',
        seed: 999,
        version: 1,
        versionNonce: 888,
      }),
    ];
    const result = reconcileElements({ prev, fresh, files: {} });
    const el = result.elements[0]!;
    expect(el.id).toBe('stable-id-1');
    expect(el.seed).toBe(111);
    expect(el.version).toBe(7);
    expect(el.versionNonce).toBe(222);
  });

  it('does NOT copy identity across different types for the same primitive', () => {
    // LabelBox emits a rectangle AND a text element — both with the same
    // drawcastPrimitiveId. The reconciler must keep them disambiguated by
    // type so the text doesn't inherit the rectangle's id.
    const prev = [
      make('p1', 'rectangle', { id: 'rect-id', version: 3 }),
      make('p1', 'text', { id: 'text-id', version: 5 }),
    ];
    const fresh = [
      make('p1', 'rectangle', { id: 'fresh-rect', version: 1 }),
      make('p1', 'text', { id: 'fresh-text', version: 1 }),
    ];
    const result = reconcileElements({ prev, fresh, files: {} });
    expect(result.elements[0]!.id).toBe('rect-id');
    expect(result.elements[0]!.version).toBe(3);
    expect(result.elements[1]!.id).toBe('text-id');
    expect(result.elements[1]!.version).toBe(5);
  });

  it('leaves a fresh id in place for a primitive without a prior match', () => {
    const prev = [make('p1', 'rectangle', { id: 'old' })];
    const fresh = [
      make('p1', 'rectangle', { id: 'reused' }),
      make('p2', 'rectangle', { id: 'brand-new' }),
    ];
    const result = reconcileElements({ prev, fresh, files: {} });
    // p1 gets the stable id.
    expect(result.elements[0]!.id).toBe('old');
    // p2 is new — keeps the fresh id.
    expect(result.elements[1]!.id).toBe('brand-new');
  });

  // B4: once a primitive is edit-locked by the user, later MCP snapshots
  // must NOT trample its local geometry. The reconciler is where that
  // preference is enforced — it has both the prior rendered element
  // (the user's edited state) and the fresh compile, and returns the
  // prior object verbatim whenever the primitive id is in the lock set.
  it('keeps the full prior element for locked primitives (geometry + identity)', () => {
    const prev = [
      make('b1', 'rectangle', {
        id: 'stable-id',
        x: 500,
        y: 500,
        width: 120,
        height: 60,
        version: 7,
      }),
    ];
    const fresh = [
      make('b1', 'rectangle', {
        id: 'fresh-id',
        x: 100,
        y: 100,
        width: 80,
        height: 40,
        version: 1,
      }),
    ];
    const result = reconcileElements({
      prev,
      fresh,
      files: {},
      lockedIds: new Set(['b1']),
    });
    const el = result.elements[0]!;
    expect(el.id).toBe('stable-id');
    expect(el.x).toBe(500);
    expect(el.y).toBe(500);
    expect(el.width).toBe(120);
    expect(el.height).toBe(60);
    expect(el.version).toBe(7);
  });

  it('unlocked primitive adopts fresh geometry but keeps the stable id', () => {
    const prev = [
      make('b1', 'rectangle', { id: 'stable-id', x: 500, y: 500, version: 7 }),
    ];
    const fresh = [
      make('b1', 'rectangle', { id: 'fresh-id', x: 100, y: 100, version: 1 }),
    ];
    const result = reconcileElements({
      prev,
      fresh,
      files: {},
      lockedIds: new Set(),
    });
    const el = result.elements[0]!;
    expect(el.id).toBe('stable-id');
    expect(el.x).toBe(100);
    expect(el.y).toBe(100);
    expect(el.version).toBe(7);
  });

  it('lockedIds is optional — omitted means "none locked"', () => {
    const prev = [
      make('b1', 'rectangle', { id: 'stable-id', x: 500, y: 500 }),
    ];
    const fresh = [
      make('b1', 'rectangle', { id: 'fresh-id', x: 100, y: 100 }),
    ];
    const result = reconcileElements({ prev, fresh, files: {} });
    expect(result.elements[0]!.x).toBe(100);
    expect(result.elements[0]!.y).toBe(100);
  });
});
