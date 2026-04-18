// End-to-end integration: drive the three core tools through the MCP
// transport pair so we verify the dispatch table, not just `execute`.

import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { LabelBox, PrimitiveId } from '@drawcast/core';
import { createServer } from '../src/server.js';
import { coreTools } from '../src/tools/index.js';

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
  it('coreTools exposes exactly the three upsert primitives', () => {
    expect(coreTools).toHaveLength(3);
    expect(coreTools.map((t) => t.name).sort()).toEqual([
      'draw_upsert_box',
      'draw_upsert_edge',
      'draw_upsert_sticky',
    ]);
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
