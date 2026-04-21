// Behaviour tests for the `draw_upsert_edge` tool.

import { describe, expect, it } from 'vitest';
import type { Connector, PrimitiveId } from '@drawcast/core';
import { SceneStore } from '../src/store.js';
import { drawUpsertEdge } from '../src/tools/drawUpsertEdge.js';
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

describe('draw_upsert_edge', () => {
  it('writes a Connector with primitive-id endpoints', async () => {
    const store = new SceneStore();
    const result = await drawUpsertEdge.execute(
      { id: 'e1', from: 'a', to: 'b' },
      store,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe('\u2713 edge e1 a \u2192 b');
    const stored = store.getPrimitive(asId('e1')) as Connector;
    expect(stored.kind).toBe('connector');
    expect(stored.from).toBe('a');
    expect(stored.to).toBe('b');
  });

  it('accepts scene-coordinate endpoints', async () => {
    const store = new SceneStore();
    await drawUpsertEdge.execute(
      { id: 'e2', from: [0, 0], to: [100, 50] },
      store,
    );
    const stored = store.getPrimitive(asId('e2')) as Connector;
    expect(stored.from).toEqual([0, 0]);
    expect(stored.to).toEqual([100, 50]);
  });

  it('mixes id and coordinate endpoints', async () => {
    const store = new SceneStore();
    const result = await drawUpsertEdge.execute(
      { id: 'e3', from: 'src', to: [10, 20] },
      store,
    );
    expect(result.content[0]?.text).toBe('\u2713 edge e3 src \u2192 [10, 20]');
  });

  it('carries label, routing, and arrowhead overrides onto the Connector', async () => {
    const store = new SceneStore();
    await drawUpsertEdge.execute(
      {
        id: 'e4',
        from: 'a',
        to: 'b',
        label: 'yes',
        routing: 'elbow',
        arrowhead: { start: null, end: 'triangle' },
      },
      store,
    );
    const stored = store.getPrimitive(asId('e4')) as Connector;
    expect(stored.label).toBe('yes');
    expect(stored.routing).toBe('elbow');
    expect(stored.arrowhead).toEqual({ start: null, end: 'triangle' });
  });

  it('overwrites an existing edge with the same id', async () => {
    const store = new SceneStore();
    await drawUpsertEdge.execute(
      { id: 'e', from: 'a', to: 'b', label: 'first' },
      store,
    );
    await drawUpsertEdge.execute(
      { id: 'e', from: 'a', to: 'c', label: 'second' },
      store,
    );
    expect(store.getAllPrimitives()).toHaveLength(1);
    const stored = store.getPrimitive(asId('e')) as Connector;
    expect(stored.to).toBe('c');
    expect(stored.label).toBe('second');
  });

  it('returns isError when required `to` is missing', async () => {
    const store = new SceneStore();
    const result = await drawUpsertEdge.execute(
      { id: 'e', from: 'a' } as never,
      store,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/to:/i);
    expect(store.getAllPrimitives()).toHaveLength(0);
  });

  it('returns isError with unlock hint when the id is locked', async () => {
    const store = new SceneStore();
    store.lock([asId('e')]);
    const result = await drawUpsertEdge.execute(
      { id: 'e', from: 'a', to: 'b' },
      store,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/locked/i);
  });

  it('appends an image block when returnPreview:true and the bus responds', async () => {
    const store = new SceneStore();
    const bus = stubBus({ data: 'QUFB', mimeType: 'image/png' });
    const result = await drawUpsertEdge.execute(
      { id: 'e', from: 'a', to: 'b', returnPreview: true },
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
    const result = await drawUpsertEdge.execute(
      { id: 'e', from: 'a', to: 'b', returnPreview: true },
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
    store.lock([asId('e')]);
    const bus = stubBus({ data: 'QUFB', mimeType: 'image/png' });
    const result = await drawUpsertEdge.execute(
      { id: 'e', from: 'a', to: 'b', returnPreview: true },
      store,
      { previewBus: bus },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
  });

  it('converts a literal \\n inside the edge label into a real newline', async () => {
    // Regression: mirrors the box/sticky sanitizer — edge labels take the
    // same path so the same double-escape hazard applies.
    const store = new SceneStore();
    await drawUpsertEdge.execute(
      { id: 'e', from: 'a', to: 'b', label: 'retry\\nif failed' },
      store,
    );
    const stored = store.getPrimitive(asId('e')) as Connector;
    expect(stored.label).toBe('retry\nif failed');
  });
});
