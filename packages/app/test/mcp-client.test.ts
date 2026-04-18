// Tests for the browser-side MCP client. We drive it with a tiny
// EventSource polyfill (jsdom ships no real implementation) plus a
// mocked `fetch` so we don't actually hit the network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMcpClient } from '../src/mcp/client.js';

type OpenListener = () => void;
type MessageListener = (evt: MessageEvent<string>) => void;
type ErrorListener = () => void;

interface MockEventSource {
  url: string;
  readyState: number;
  close(): void;
  emit(kind: string, data: unknown): void;
  emitError(): void;
  emitOpen(): void;
  emitMessage(data: unknown): void;
  addEventListener(kind: string, cb: MessageListener): void;
  onopen: OpenListener | null;
  onerror: ErrorListener | null;
  onmessage: MessageListener | null;
}

const instances: MockEventSource[] = [];

class MockEventSourceImpl implements MockEventSource {
  url: string;
  readyState = 0;
  private listeners = new Map<string, Set<MessageListener>>();
  onopen: OpenListener | null = null;
  onerror: ErrorListener | null = null;
  onmessage: MessageListener | null = null;

  constructor(url: string) {
    this.url = url;
    instances.push(this);
  }

  addEventListener(kind: string, cb: MessageListener): void {
    if (!this.listeners.has(kind)) this.listeners.set(kind, new Set());
    this.listeners.get(kind)!.add(cb);
  }

  close(): void {
    this.readyState = 2;
  }

  emit(kind: string, data: unknown): void {
    const evt = {
      data: typeof data === 'string' ? data : JSON.stringify(data),
    } as MessageEvent<string>;
    const set = this.listeners.get(kind);
    if (set) {
      for (const cb of set) cb(evt);
    }
  }

  emitError(): void {
    this.onerror?.();
  }

  emitOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  emitMessage(data: unknown): void {
    const evt = {
      data: typeof data === 'string' ? data : JSON.stringify(data),
    } as MessageEvent<string>;
    this.onmessage?.(evt);
  }
}

describe('createMcpClient', () => {
  beforeEach(() => {
    instances.length = 0;
    // Install our mock EventSource globally.
    (globalThis as { EventSource?: unknown }).EventSource =
      MockEventSourceImpl;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('POSTs selection to /selection with JSON body', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    (globalThis as { fetch?: unknown }).fetch = fetchSpy;

    const client = createMcpClient(43017);
    await client.postSelection(['a', 'b']);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [url, init] = firstCall as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:43017/selection');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ ids: ['a', 'b'] });
  });

  it('parses SSE scene payloads and forwards to onScene subscribers', () => {
    const client = createMcpClient(43017);
    const received: Array<{ primitives: unknown[] }> = [];
    client.onScene((snap) => {
      received.push({ primitives: snap.primitives });
    });
    client.connect();

    const es = instances[0];
    if (es === undefined) {
      throw new Error('EventSource never instantiated');
    }
    es.emitOpen();

    es.emit('scene', {
      primitives: [{ id: 'x', kind: 'sticky' }],
      theme: 'sketchy',
      selection: [],
      locked: [],
    });

    expect(received.length).toBe(1);
    expect(received[0]!.primitives).toHaveLength(1);
  });

  it('emits onConnectionChange(false) on transport error', async () => {
    vi.useFakeTimers();
    const client = createMcpClient(43017);
    const states: boolean[] = [];
    client.onConnectionChange((c) => {
      states.push(c);
    });
    client.connect();

    const es = instances[0];
    if (es === undefined) {
      throw new Error('EventSource never instantiated');
    }
    es.emitOpen();
    expect(states).toContain(true);

    es.emitError();
    // The error handler flips connected=false synchronously.
    expect(states).toContain(false);

    // Advance past the backoff so a reconnect EventSource is spawned.
    await vi.advanceTimersByTimeAsync(1500);
    expect(instances.length).toBeGreaterThanOrEqual(2);

    client.disconnect();
  });
});
