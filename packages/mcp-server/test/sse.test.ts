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

describe('preview pipeline', () => {
  it('resolves the await promise when the app POSTs /preview', async () => {
    const { handle } = await boot();

    // Subscribe to /events so the preview bus sees a live client. We just
    // need the socket open — we don't actually need to consume the frames
    // for this test since we're driving the resolver directly.
    const esRes = await fetch(`${handle.url}/events`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(esRes.status).toBe(200);
    const reader = esRes.body?.getReader();
    expect(reader).toBeDefined();

    const requestId = 'req-abc';
    const pending = handle.previewBus.awaitResponse(requestId, 2000);

    // Mimic the app: POST /preview with the requestId + base64 payload.
    const post = await fetch(`${handle.url}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        data: 'ZmFrZQ==',
        mimeType: 'image/png',
      }),
    });
    expect(post.status).toBe(200);

    const response = (await pending) as { data: string; mimeType: string };
    expect(response.data).toBe('ZmFrZQ==');
    expect(response.mimeType).toBe('image/png');

    await reader?.cancel();
  });

  it('emits a requestPreview event to every /events subscriber', async () => {
    const { handle } = await boot();

    async function readUntil(
      reader: ReadableStreamDefaultReader<Uint8Array>,
      needle: string,
      deadline: number,
    ): Promise<string> {
      const decoder = new TextDecoder();
      let buf = '';
      while (Date.now() < deadline) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        if (buf.includes(needle)) return buf;
      }
      return buf;
    }

    const [subA, subB] = await Promise.all([
      fetch(`${handle.url}/events`, {
        headers: { Accept: 'text/event-stream' },
      }),
      fetch(`${handle.url}/events`, {
        headers: { Accept: 'text/event-stream' },
      }),
    ]);
    const readerA = subA.body!.getReader();
    const readerB = subB.body!.getReader();

    // Give the server a moment to register both subscribers.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handle.eventSubscriberCount()).toBe(2);

    handle.previewBus.emitRequest('req-xyz', 'png', 2);

    const deadline = Date.now() + 500;
    const [bufA, bufB] = await Promise.all([
      readUntil(readerA, 'event: requestPreview', deadline),
      readUntil(readerB, 'event: requestPreview', deadline),
    ]);
    expect(bufA).toContain('event: requestPreview');
    expect(bufA).toContain('"requestId":"req-xyz"');
    expect(bufB).toContain('event: requestPreview');

    await readerA.cancel();
    await readerB.cancel();
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
