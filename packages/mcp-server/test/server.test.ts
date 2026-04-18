// Server-wiring tests.
//
// These exercise the MCP handshake through the SDK's in-memory transport
// pair so we get real protocol framing without touching stdio or the
// network.

import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { SceneStore } from '../src/store.js';

async function connectPair(options?: Parameters<typeof createServer>[0]) {
  const drawcast = createServer(options);
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

describe('createServer', () => {
  it('returns both the Server and a SceneStore', () => {
    const drawcast = createServer();
    expect(drawcast.server).toBeDefined();
    expect(drawcast.store).toBeInstanceOf(SceneStore);
  });

  it('reuses an injected SceneStore', () => {
    const store = new SceneStore();
    const drawcast = createServer({ store });
    expect(drawcast.store).toBe(store);
  });

  it('responds to tools/list with the default core tool set', async () => {
    const { client } = await connectPair();
    const result = await client.listTools();
    // Full 15-tool surface — PR #10 extended PR #9's three with structural,
    // coverage, query, mutation, theme, and export tools; PR #18 adds
    // `draw_get_preview`.
    expect(result.tools.map((t) => t.name).sort()).toEqual([
      'draw_clear',
      'draw_export',
      'draw_get_preview',
      'draw_get_primitive',
      'draw_get_scene',
      'draw_get_selection',
      'draw_list_style_presets',
      'draw_remove',
      'draw_set_theme',
      'draw_upsert_box',
      'draw_upsert_edge',
      'draw_upsert_frame',
      'draw_upsert_group',
      'draw_upsert_shape',
      'draw_upsert_sticky',
    ]);
    for (const tool of result.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(typeof tool.description).toBe('string');
    }
    await client.close();
  });

  it('returns an isError response when tools/call hits an unknown tool', async () => {
    const { client } = await connectPair({ tools: [] });
    const result = await client.callTool({
      name: 'draw_upsert_box',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text: string }[];
    expect(content[0]?.text).toMatch(/draw_upsert_box/);
    await client.close();
  });
});
