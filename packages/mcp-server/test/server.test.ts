// Server-wiring tests.
//
// These exercise the MCP handshake through the SDK's in-memory transport
// pair so we get real protocol framing without touching stdio or the
// network. Heavier tool-behaviour tests land with PR #9.

import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { SceneStore } from '../src/store.js';

async function connectPair() {
  const drawcast = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
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

  it('responds to tools/list with an empty list', async () => {
    const { client } = await connectPair();
    const result = await client.listTools();
    expect(result.tools).toEqual([]);
    await client.close();
  });

  it('returns a clear error when tools/call is invoked before any tool is registered', async () => {
    const { client } = await connectPair();
    await expect(
      client.callTool({ name: 'draw_upsert_box', arguments: {} }),
    ).rejects.toThrow(/draw_upsert_box/);
    await client.close();
  });
});
