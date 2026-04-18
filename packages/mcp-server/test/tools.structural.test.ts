// Behaviour tests for the structural upsert tools (group + frame).

import { describe, expect, it } from 'vitest';
import type { Frame, Group, PrimitiveId } from '@drawcast/core';
import { SceneStore } from '../src/store.js';
import { drawUpsertFrame } from '../src/tools/drawUpsertFrame.js';
import { drawUpsertGroup } from '../src/tools/drawUpsertGroup.js';

function asId(raw: string): PrimitiveId {
  return raw as PrimitiveId;
}

describe('draw_upsert_group', () => {
  it('stores a Group with the given children', async () => {
    const store = new SceneStore();
    const result = await drawUpsertGroup.execute(
      { id: 'g1', children: ['a', 'b', 'c'] },
      store,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(
      '\u2713 group g1 upserted (3 children)',
    );
    const stored = store.getPrimitive(asId('g1')) as Group;
    expect(stored.kind).toBe('group');
    expect(stored.children).toEqual(['a', 'b', 'c']);
  });

  it('returns isError when id is missing', async () => {
    const store = new SceneStore();
    const result = await drawUpsertGroup.execute(
      { children: ['a'] } as never,
      store,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/id:/i);
    expect(store.getAllPrimitives()).toHaveLength(0);
  });

  it('rejects mutations against locked ids', async () => {
    const store = new SceneStore();
    store.lock([asId('g1')]);
    const result = await drawUpsertGroup.execute(
      { id: 'g1', children: ['a'] },
      store,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/locked/i);
  });
});

describe('draw_upsert_frame', () => {
  it('stores a Frame with title, position, size, and children', async () => {
    const store = new SceneStore();
    const result = await drawUpsertFrame.execute(
      {
        id: 'f1',
        title: 'Sprint 1',
        at: [0, 0],
        size: [400, 300],
        children: ['a', 'b'],
      },
      store,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(
      '\u2713 frame f1 upserted (2 children)',
    );
    const stored = store.getPrimitive(asId('f1')) as Frame;
    expect(stored.kind).toBe('frame');
    expect(stored.title).toBe('Sprint 1');
    expect(stored.at).toEqual([0, 0]);
    expect(stored.size).toEqual([400, 300]);
    expect(stored.children).toEqual(['a', 'b']);
  });

  it('rejects a non-positive frame size', async () => {
    const store = new SceneStore();
    const result = await drawUpsertFrame.execute(
      { id: 'f', at: [0, 0], size: [0, 100], children: [] },
      store,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/size/i);
  });
});
