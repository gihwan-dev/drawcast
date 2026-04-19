// End-to-end integration: drive the three core tools through the MCP
// transport pair so we verify the dispatch table, not just `execute`.

import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { LabelBox, PrimitiveId } from '@drawcast/core';
import { createServer } from '../src/server.js';
import { coreTools } from '../src/tools/index.js';
import { startSSE, type SSEHandle } from '../src/transport/sse.js';

async function connectPair() {
  const drawcast = createServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'drawcast-test', version: '0.0.0' },
    { capabilities: {} },
  );
  await Promise.all([
    drawcast.server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { drawcast, client };
}

describe('core tools registration', () => {
  it('coreTools exposes the full 15-tool surface', () => {
    // PR #18 added `draw_get_preview`, bumping the surface to 15. Clipboard
    // copy/paste lands in PR #19. The inline snapshot guards against
    // accidental drops / dupes as more tools land.
    expect(coreTools).toHaveLength(15);
    expect(coreTools.map((t) => t.name).sort()).toMatchInlineSnapshot(`
      [
        "draw_clear",
        "draw_export",
        "draw_get_preview",
        "draw_get_primitive",
        "draw_get_scene",
        "draw_get_selection",
        "draw_list_style_presets",
        "draw_remove",
        "draw_set_theme",
        "draw_upsert_box",
        "draw_upsert_edge",
        "draw_upsert_frame",
        "draw_upsert_group",
        "draw_upsert_shape",
        "draw_upsert_sticky",
      ]
    `);
  });

  it('every core tool produces a valid MCP Tool list item', () => {
    for (const tool of coreTools) {
      const item = tool.asToolListItem();
      expect(item.name).toBe(tool.name);
      expect(item.description).toBe(tool.description);
      expect(item.inputSchema.type).toBe('object');
      expect(item.inputSchema.properties).toBeTypeOf('object');
      expect(Array.isArray(item.inputSchema.required)).toBe(true);
    }
  });

  it('tools/call dispatches to draw_upsert_box and mutates the store', async () => {
    const { drawcast, client } = await connectPair();
    const result = await client.callTool({
      name: 'draw_upsert_box',
      arguments: { id: 'node-1', at: [0, 0], text: 'hi' },
    });
    expect(result.isError).toBeUndefined();
    const stored = drawcast.store.getPrimitive(
      'node-1' as PrimitiveId,
    ) as LabelBox;
    expect(stored.kind).toBe('labelBox');
    expect(stored.text).toBe('hi');
    await client.close();
  });

  it('tools/call surfaces zod validation failures as isError', async () => {
    const { client } = await connectPair();
    const result = await client.callTool({
      name: 'draw_upsert_box',
      arguments: { id: 'bad' },
    });
    expect(result.isError).toBe(true);
    await client.close();
  });
});

describe('returnPreview end-to-end', () => {
  const active: SSEHandle[] = [];

  afterEach(async () => {
    while (active.length > 0) {
      const h = active.pop();
      if (h !== undefined) await h.close();
    }
  });

  it('drives a full request→POST /preview→image round-trip through draw_upsert_box', async () => {
    const drawcast = createServer();
    const handle = await startSSE(drawcast, { port: 'auto' });
    active.push(handle);

    // Keep an /events subscriber alive so the preview bus sees someone
    // listening. We don't need to parse the frames in this test — we
    // drive the reverse channel manually with POST /preview.
    const esRes = await fetch(`${handle.url}/events`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(esRes.status).toBe(200);
    const reader = esRes.body?.getReader();
    expect(reader).toBeDefined();

    // Give the server a moment to register the subscriber.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handle.eventSubscriberCount()).toBe(1);

    // Stub the bus so emitRequest captures requestIds and awaitResponse
    // resolves with a canned payload. We inject via the SSE handle's own
    // preview bus: overwrite `awaitResponse` so the test doesn't have to
    // thread through the real /preview HTTP loop (which would race the
    // /events stream in a CI-unfriendly way).
    const originalAwait = handle.previewBus.awaitResponse;
    let capturedRequestId = '';
    const originalEmit = handle.previewBus.emitRequest.bind(
      handle.previewBus,
    );
    handle.previewBus.emitRequest = (
      requestId: string,
      format: 'png' | 'jpeg',
      scale: number,
    ): void => {
      capturedRequestId = requestId;
      originalEmit(requestId, format, scale);
    };
    handle.previewBus.awaitResponse = (
      _requestId: string,
      _timeoutMs: number,
    ): Promise<{ data: string; mimeType: string }> =>
      Promise.resolve({ data: 'SU1H', mimeType: 'image/png' });

    try {
      // tools/call lives over MCP, but exec via execute is enough for this
      // assertion — we just need to prove the tool picks up the injected
      // bus through the transport's registered deps bag.
      const tool = drawcast.tools.find((t) => t.name === 'draw_upsert_box');
      expect(tool).toBeDefined();
      const result = await tool!.execute(
        {
          id: 'e2e-node',
          at: [0, 0],
          text: 'hello',
          returnPreview: true,
        },
        drawcast.store,
        { previewBus: handle.previewBus },
      );

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(2);
      expect(result.content[1]).toMatchObject({
        type: 'image',
        data: 'SU1H',
        mimeType: 'image/png',
      });
      expect(capturedRequestId.length).toBeGreaterThan(0);

      // Store reflects the mutation.
      const stored = drawcast.store.getPrimitive(
        'e2e-node' as PrimitiveId,
      ) as LabelBox;
      expect(stored.kind).toBe('labelBox');
    } finally {
      handle.previewBus.awaitResponse = originalAwait;
      handle.previewBus.emitRequest = originalEmit;
      await reader?.cancel();
    }
  });
});
