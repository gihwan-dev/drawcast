// Behaviour tests for the `draw_upsert_box` tool.
//
// These call `execute` directly against a fresh `SceneStore` — cheaper and
// more precise than going through the MCP transport pair.

import { describe, expect, it } from 'vitest';
import type { LabelBox, PrimitiveId } from '@drawcast/core';
import { SceneStore } from '../src/store.js';
import { drawUpsertBox } from '../src/tools/drawUpsertBox.js';
import type { PreviewBus, PreviewResponse } from '../src/preview-bus.js';

function asId(raw: string): PrimitiveId {
  return raw as PrimitiveId;
}

function stubBus(response: PreviewResponse): PreviewBus {
  return {
    emitRequest(): void {},
    awaitResponse(): Promise<PreviewResponse> {
      return Promise.resolve(response);
    },
    hasSubscribers(): boolean {
      return true;
    },
  };
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

  it('normalises literal "\\n" escape sequences in text into real newlines', async () => {
    const store = new SceneStore();
    await drawUpsertBox.execute(
      {
        id: 'multi-line',
        text: '입력 오류 표시\\n(형식 불일치)',
        at: [0, 0],
      },
      store,
    );
    const stored = store.getPrimitive(asId('multi-line')) as LabelBox;
    expect(stored.text).toBe('입력 오류 표시\n(형식 불일치)');
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

  it('appends an image block when returnPreview:true and the bus responds', async () => {
    const store = new SceneStore();
    const bus = stubBus({ data: 'QUFB', mimeType: 'image/png' });
    const result = await drawUpsertBox.execute(
      { id: 'node', at: [0, 0], returnPreview: true },
      store,
      { previewBus: bus },
    );
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({
      type: 'text',
      text: '\u2713 box node upserted',
    });
    expect(result.content[1]).toEqual({
      type: 'image',
      data: 'QUFB',
      mimeType: 'image/png',
    });
    // Mutation succeeded even when preview is attached.
    expect(store.getAllPrimitives()).toHaveLength(1);
  });

  it('degrades gracefully with a warning text block when no bus is available', async () => {
    const store = new SceneStore();
    const result = await drawUpsertBox.execute(
      { id: 'node', at: [0, 0], returnPreview: true },
      store,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(2);
    const warning = result.content[1] as { type: 'text'; text: string };
    expect(warning.type).toBe('text');
    expect(warning.text).toMatch(/headless/i);
    // Store still reflects the mutation.
    expect(store.getAllPrimitives()).toHaveLength(1);
  });

  it('skips preview entirely when the mutation itself fails', async () => {
    const store = new SceneStore();
    store.lock([asId('a')]);
    const bus = stubBus({ data: 'QUFB', mimeType: 'image/png' });
    const result = await drawUpsertBox.execute(
      { id: 'a', at: [0, 0], returnPreview: true },
      store,
      { previewBus: bus },
    );
    expect(result.isError).toBe(true);
    // No image block attached — only the lock error text.
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: 'text' });
  });
});
