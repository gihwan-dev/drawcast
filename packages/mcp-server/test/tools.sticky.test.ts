// Behaviour tests for the `draw_upsert_sticky` tool.

import { describe, expect, it } from 'vitest';
import type { PrimitiveId, Sticky } from '@drawcast/core';
import { SceneStore } from '../src/store.js';
import { drawUpsertSticky } from '../src/tools/drawUpsertSticky.js';
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

describe('draw_upsert_sticky', () => {
  it('writes a Sticky primitive with text and position', async () => {
    const store = new SceneStore();
    const result = await drawUpsertSticky.execute(
      { id: 'note-1', text: 'hello', at: [10, 20] },
      store,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe('\u2713 sticky note-1 upserted');
    const stored = store.getPrimitive(asId('note-1')) as Sticky;
    expect(stored.kind).toBe('sticky');
    expect(stored.text).toBe('hello');
    expect(stored.at).toEqual([10, 20]);
  });

  it('overwrites an existing sticky with the same id', async () => {
    const store = new SceneStore();
    await drawUpsertSticky.execute(
      { id: 's', text: 'first', at: [0, 0] },
      store,
    );
    await drawUpsertSticky.execute(
      { id: 's', text: 'second', at: [0, 0] },
      store,
    );
    expect(store.getAllPrimitives()).toHaveLength(1);
    const stored = store.getPrimitive(asId('s')) as Sticky;
    expect(stored.text).toBe('second');
  });

  it('carries optional width / fontFamily / textAlign onto the primitive', async () => {
    const store = new SceneStore();
    await drawUpsertSticky.execute(
      {
        id: 's',
        text: 'legend',
        at: [0, 0],
        width: 200,
        fontFamily: 2,
        textAlign: 'center',
      },
      store,
    );
    const stored = store.getPrimitive(asId('s')) as Sticky;
    expect(stored.width).toBe(200);
    expect(stored.fontFamily).toBe(2);
    expect(stored.textAlign).toBe('center');
  });

  it('returns isError when required `text` is missing', async () => {
    const store = new SceneStore();
    const result = await drawUpsertSticky.execute(
      { id: 's', at: [0, 0] } as never,
      store,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/text:/i);
    expect(store.getAllPrimitives()).toHaveLength(0);
  });

  it('returns isError with Reset edits hint when the id is locked', async () => {
    const store = new SceneStore();
    store.lock([asId('s')]);
    const result = await drawUpsertSticky.execute(
      { id: 's', text: 'hi', at: [0, 0] },
      store,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/locked/i);
    expect(result.content[0]?.text).toContain('Reset edits');
  });

  it('appends an image block when returnPreview:true and the bus responds', async () => {
    const store = new SceneStore();
    const bus = stubBus({ data: 'QUFB', mimeType: 'image/png' });
    const result = await drawUpsertSticky.execute(
      { id: 's', text: 'hi', at: [0, 0], returnPreview: true },
      store,
      { previewBus: bus },
    );
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(2);
    expect(result.content[1]).toEqual({
      type: 'image',
      data: 'QUFB',
      mimeType: 'image/png',
    });
  });

  it('degrades gracefully with a warning when no bus is available', async () => {
    const store = new SceneStore();
    const result = await drawUpsertSticky.execute(
      { id: 's', text: 'hi', at: [0, 0], returnPreview: true },
      store,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(2);
    const warning = result.content[1] as { type: 'text'; text: string };
    expect(warning.text).toMatch(/headless/i);
    expect(store.getAllPrimitives()).toHaveLength(1);
  });

  it('skips preview entirely when the mutation itself fails', async () => {
    const store = new SceneStore();
    store.lock([asId('s')]);
    const bus = stubBus({ data: 'QUFB', mimeType: 'image/png' });
    const result = await drawUpsertSticky.execute(
      { id: 's', text: 'hi', at: [0, 0], returnPreview: true },
      store,
      { previewBus: bus },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
  });

  it('converts a literal \\n inside sticky text into a real newline', async () => {
    // Regression: the tool description advertises "\\n" as the multi-line
    // separator, so clients that send the literal backslash-n must still
    // render as an actual line break.
    const store = new SceneStore();
    await drawUpsertSticky.execute(
      { id: 'legend', text: 'line1\\nline2', at: [0, 0] },
      store,
    );
    const stored = store.getPrimitive(asId('legend')) as Sticky;
    expect(stored.text).toBe('line1\nline2');
  });
});
