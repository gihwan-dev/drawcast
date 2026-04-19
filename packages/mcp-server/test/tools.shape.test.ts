// Behaviour tests for the discriminated-union `draw_upsert_shape` tool.

import { describe, expect, it } from 'vitest';
import type {
  Embed,
  Freedraw,
  Image,
  Line,
  PrimitiveId,
} from '@drawcast/core';
import { SceneStore } from '../src/store.js';
import { drawUpsertShape } from '../src/tools/drawUpsertShape.js';
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

describe('draw_upsert_shape', () => {
  it('builds a Line from kind:"line"', async () => {
    const store = new SceneStore();
    const result = await drawUpsertShape.execute(
      {
        kind: 'line',
        id: 'L',
        at: [0, 0],
        points: [
          [0, 0],
          [10, 5],
          [20, 0],
        ],
        dashed: true,
        polygon: false,
      },
      store,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe('\u2713 line L upserted');
    const stored = store.getPrimitive(asId('L')) as Line;
    expect(stored.kind).toBe('line');
    expect(stored.points).toHaveLength(3);
    expect(stored.dashed).toBe(true);
  });

  it('rejects a line with fewer than two points', async () => {
    const store = new SceneStore();
    const result = await drawUpsertShape.execute(
      { kind: 'line', id: 'L', at: [0, 0], points: [[0, 0]] },
      store,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/points/i);
  });

  it('builds a Freedraw with pressures array', async () => {
    const store = new SceneStore();
    const result = await drawUpsertShape.execute(
      {
        kind: 'freedraw',
        id: 'F',
        at: [0, 0],
        points: [
          [0, 0],
          [1, 1],
        ],
        pressures: [0.5, 0.8],
        simulatePressure: false,
      },
      store,
    );
    expect(result.isError).toBeUndefined();
    const stored = store.getPrimitive(asId('F')) as Freedraw;
    expect(stored.kind).toBe('freedraw');
    expect(stored.pressures).toEqual([0.5, 0.8]);
    expect(stored.simulatePressure).toBe(false);
  });

  it('builds an Image with a path source', async () => {
    const store = new SceneStore();
    const result = await drawUpsertShape.execute(
      {
        kind: 'image',
        id: 'I',
        at: [0, 0],
        size: [200, 100],
        source: { kind: 'path', path: 'uploads/diagram.png' },
      },
      store,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe('\u2713 image I upserted');
    const stored = store.getPrimitive(asId('I')) as Image;
    expect(stored.kind).toBe('image');
    expect(stored.source).toEqual({
      kind: 'path',
      path: 'uploads/diagram.png',
    });
  });

  it('builds an Image with a data URL source', async () => {
    const store = new SceneStore();
    await drawUpsertShape.execute(
      {
        kind: 'image',
        id: 'I2',
        at: [0, 0],
        size: [32, 32],
        source: {
          kind: 'data',
          dataURL: 'data:image/png;base64,AAA',
          mimeType: 'image/png',
        },
      },
      store,
    );
    const stored = store.getPrimitive(asId('I2')) as Image;
    expect(stored.source).toEqual({
      kind: 'data',
      dataURL: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
    });
  });

  it('builds an Embed with url and validated flag', async () => {
    const store = new SceneStore();
    const result = await drawUpsertShape.execute(
      {
        kind: 'embed',
        id: 'E',
        at: [0, 0],
        size: [400, 300],
        url: 'https://www.youtube.com/embed/abc',
        validated: true,
      },
      store,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe('\u2713 embed E upserted');
    const stored = store.getPrimitive(asId('E')) as Embed;
    expect(stored.kind).toBe('embed');
    expect(stored.url).toBe('https://www.youtube.com/embed/abc');
    expect(stored.validated).toBe(true);
  });

  it('rejects an unknown `kind`', async () => {
    const store = new SceneStore();
    const result = await drawUpsertShape.execute(
      { kind: 'circle', id: 'X', at: [0, 0] } as never,
      store,
    );
    expect(result.isError).toBe(true);
    expect(store.getAllPrimitives()).toHaveLength(0);
  });

  it('respects edit locks', async () => {
    const store = new SceneStore();
    store.lock([asId('L')]);
    const result = await drawUpsertShape.execute(
      {
        kind: 'line',
        id: 'L',
        at: [0, 0],
        points: [
          [0, 0],
          [10, 10],
        ],
      },
      store,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/locked/i);
  });

  it('appends an image block when returnPreview:true and the bus responds (line branch)', async () => {
    const store = new SceneStore();
    const bus = stubBus({ data: 'QUFB', mimeType: 'image/png' });
    const result = await drawUpsertShape.execute(
      {
        kind: 'line',
        id: 'L',
        at: [0, 0],
        points: [
          [0, 0],
          [10, 10],
        ],
        returnPreview: true,
      },
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

  it('degrades gracefully with a warning when no bus is available (line branch)', async () => {
    const store = new SceneStore();
    const result = await drawUpsertShape.execute(
      {
        kind: 'line',
        id: 'L',
        at: [0, 0],
        points: [
          [0, 0],
          [10, 10],
        ],
        returnPreview: true,
      },
      store,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(2);
    const warning = result.content[1] as { type: 'text'; text: string };
    expect(warning.text).toMatch(/headless/i);
    expect(store.getAllPrimitives()).toHaveLength(1);
  });

  it('skips preview entirely when the mutation itself fails (line branch)', async () => {
    const store = new SceneStore();
    store.lock([asId('L')]);
    const bus = stubBus({ data: 'QUFB', mimeType: 'image/png' });
    const result = await drawUpsertShape.execute(
      {
        kind: 'line',
        id: 'L',
        at: [0, 0],
        points: [
          [0, 0],
          [10, 10],
        ],
        returnPreview: true,
      },
      store,
      { previewBus: bus },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
  });
});
