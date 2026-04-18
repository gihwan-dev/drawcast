// Behaviour tests for the `draw_upsert_box` tool.
//
// These call `execute` directly against a fresh `SceneStore` — cheaper and
// more precise than going through the MCP transport pair.

import { describe, expect, it } from 'vitest';
import type { LabelBox, PrimitiveId } from '@drawcast/core';
import { SceneStore } from '../src/store.js';
import { drawUpsertBox } from '../src/tools/drawUpsertBox.js';

function asId(raw: string): PrimitiveId {
  return raw as PrimitiveId;
}

describe('draw_upsert_box', () => {
  it('writes a LabelBox with the expected fields on a valid call', async () => {
    const store = new SceneStore();
    const result = await drawUpsertBox.execute(
      {
        id: 'login-step',
        text: 'Login',
        shape: 'rectangle',
        at: [100, 200],
      },
      store,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe('\u2713 box login-step upserted');
    const stored = store.getPrimitive(asId('login-step')) as LabelBox;
    expect(stored.kind).toBe('labelBox');
    expect(stored.text).toBe('Login');
    expect(stored.shape).toBe('rectangle');
    expect(stored.at).toEqual([100, 200]);
  });

  it('defaults shape to rectangle when omitted', async () => {
    const store = new SceneStore();
    await drawUpsertBox.execute({ id: 'a', at: [0, 0] }, store);
    const stored = store.getPrimitive(asId('a')) as LabelBox;
    expect(stored.shape).toBe('rectangle');
  });

  it('overwrites an existing primitive with the same id', async () => {
    const store = new SceneStore();
    await drawUpsertBox.execute(
      { id: 'x', at: [0, 0], text: 'first' },
      store,
    );
    await drawUpsertBox.execute(
      { id: 'x', at: [0, 0], text: 'second', shape: 'diamond' },
      store,
    );
    expect(store.getAllPrimitives()).toHaveLength(1);
    const stored = store.getPrimitive(asId('x')) as LabelBox;
    expect(stored.text).toBe('second');
    expect(stored.shape).toBe('diamond');
  });

  it('returns isError when required `at` is missing', async () => {
    const store = new SceneStore();
    const result = await drawUpsertBox.execute(
      // Cast to bypass the compile-time check — this simulates an
      // ill-formed request coming over the wire.
      { id: 'a' } as never,
      store,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/at:/i);
    expect(store.getAllPrimitives()).toHaveLength(0);
  });

  it('returns isError when fit="fixed" but size is omitted', async () => {
    const store = new SceneStore();
    const result = await drawUpsertBox.execute(
      { id: 'a', at: [0, 0], fit: 'fixed' },
      store,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/size/i);
  });

  it('accepts an inline style override object', async () => {
    const store = new SceneStore();
    await drawUpsertBox.execute(
      {
        id: 'a',
        at: [0, 0],
        style: { strokeColor: '#ff0000', roughness: 2 },
      },
      store,
    );
    const stored = store.getPrimitive(asId('a')) as LabelBox;
    expect(stored.style).toEqual({ strokeColor: '#ff0000', roughness: 2 });
  });

  it('returns isError with Reset edits hint when the id is locked', async () => {
    const store = new SceneStore();
    store.lock([asId('a')]);
    const result = await drawUpsertBox.execute(
      { id: 'a', at: [0, 0] },
      store,
    );
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toMatch(/locked/i);
    // Points the CLI/user at the UI affordance that clears locks.
    expect(text).toContain('Reset edits');
    // Identifies which primitive is at fault.
    expect(text).toContain('a');
  });
});
