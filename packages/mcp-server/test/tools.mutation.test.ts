// Behaviour tests for the mutation tools: remove + clear.

import { describe, expect, it } from 'vitest';
import type { PrimitiveId } from '@drawcast/core';
import { SceneStore } from '../src/store.js';
import { drawClear } from '../src/tools/drawClear.js';
import { drawRemove } from '../src/tools/drawRemove.js';

function asId(raw: string): PrimitiveId {
  return raw as PrimitiveId;
}

describe('draw_remove', () => {
  it('removes an existing primitive', async () => {
    const store = new SceneStore();
    store.upsert({
      kind: 'labelBox',
      id: asId('a'),
      shape: 'rectangle',
      at: [0, 0],
    });
    const result = await drawRemove.execute({ id: 'a' }, store);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe('\u2713 removed a');
    expect(store.getAllPrimitives()).toHaveLength(0);
  });

  it('returns isError when the id is unknown', async () => {
    const store = new SceneStore();
    const result = await drawRemove.execute({ id: 'missing' }, store);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/missing/);
  });
});

describe('draw_clear', () => {
  it('refuses without confirm:true', async () => {
    const store = new SceneStore();
    store.upsert({
      kind: 'labelBox',
      id: asId('a'),
      shape: 'rectangle',
      at: [0, 0],
    });
    const result = await drawClear.execute({}, store);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/confirm/i);
    // Nothing got removed.
    expect(store.getAllPrimitives()).toHaveLength(1);
  });

  it('wipes every primitive when confirm:true is passed', async () => {
    const store = new SceneStore();
    store.upsert({
      kind: 'labelBox',
      id: asId('a'),
      shape: 'rectangle',
      at: [0, 0],
    });
    store.upsert({
      kind: 'labelBox',
      id: asId('b'),
      shape: 'ellipse',
      at: [0, 0],
    });
    const result = await drawClear.execute({ confirm: true }, store);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(/2 primitives/);
    expect(store.getAllPrimitives()).toHaveLength(0);
  });
});
