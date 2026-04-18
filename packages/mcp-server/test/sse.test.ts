// SSE transport tests.
//
// Boot the HTTP server on a random port, poke the reverse-channel endpoints
// with fetch, and assert that store state / event stream reflect the
// expected changes. The MCP JSON-RPC-over-SSE handshake is owned by the
// upstream SDK so we only smoke test the routing wiring here.

import { afterEach, describe, expect, it } from 'vitest';
import type { LabelBox, PrimitiveId } from '@drawcast/core';
import { createServer } from '../src/server.js';
import { startSSE, type SSEHandle } from '../src/transport/sse.js';

const activeHandles: SSEHandle[] = [];

afterEach(async () => {
  while (activeHandles.length > 0) {
    const handle = activeHandles.pop();
    if (handle !== undefined) {
      await handle.close();
    }
  }
});

async function boot(): Promise<{
  drawcast: ReturnType<typeof createServer>;
  handle: SSEHandle;
}> {
  const drawcast = createServer();
  const handle = await startSSE(drawcast, { port: 'auto' });
  activeHandles.push(handle);
  return { drawcast, handle };
}

function makeBox(id: string): LabelBox {
  return {
    kind: 'labelBox',
    id: id as PrimitiveId,
    shape: 'rectangle',
    at: [0, 0],
  };
}

describe('startSSE', () => {
  it('binds to an ephemeral port with --port auto', async () => {
    const { handle } = await boot();
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('responds to GET /healthz with ok + port', async () => {
    const { handle } = await boot();
    const res = await fetch(`${handle.url}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; port: number };
    expect(body.ok).toBe(true);
    expect(body.port).toBe(handle.port);
  });
});

describe('reverse-channel endpoints', () => {
  it('POST /selection updates the store selection', async () => {
    const { drawcast, handle } = await boot();
    const res = await fetch(`${handle.url}/selection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['a', 'b'] }),
    });
    expect(res.status).toBe(200);
    expect([...drawcast.store.getSelection()]).toEqual(['a', 'b']);
  });

  it('POST /edit-lock toggles store locks', async () => {
    const { drawcast, handle } = await boot();
    await fetch(`${handle.url}/edit-lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['a'], locked: true }),
    });
    expect(drawcast.store.isLocked('a' as PrimitiveId)).toBe(true);

    await fetch(`${handle.url}/edit-lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['a'], locked: false }),
    });
    expect(drawcast.store.isLocked('a' as PrimitiveId)).toBe(false);
  });

  it('POST /selection rejects malformed bodies', async () => {
    const { handle } = await boot();
    const res = await fetch(`${handle.url}/selection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wrongKey: 1 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /events', () => {
  it('delivers an initial scene snapshot on connect', async () => {
    const { drawcast, handle } = await boot();
    drawcast.store.upsert(makeBox('seeded'));

    const res = await fetch(`${handle.url}/events`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/event-stream/);

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    let buf = '';
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      const chunk = await reader!.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      if (buf.includes('event: scene')) {
        break;
      }
    }
    await reader?.cancel();

    expect(buf).toContain('event: scene');
    const match = /event: scene\ndata: (\{.*\})/.exec(buf);
    expect(match).not.toBeNull();
    const payload = JSON.parse(match![1]!) as {
      primitives: unknown[];
      theme: string;
    };
    expect(Array.isArray(payload.primitives)).toBe(true);
    expect(payload.primitives).toHaveLength(1);
    expect(payload.theme).toBe('sketchy');
  });
});
