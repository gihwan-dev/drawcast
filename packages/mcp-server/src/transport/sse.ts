// SSE transport + reverse-channel HTTP endpoints.
//
// This module stitches together three responsibilities:
//
//   1. MCP JSON-RPC over SSE — `GET /sse` opens a stream, `POST /messages`
//      forwards client-bound messages to the SDK's SSEServerTransport.
//   2. Reverse channels the Drawcast app POSTs back (`/selection`,
//      `/preview`, `/clipboard-ack`, `/edit-lock`). These let the app push
//      state changes into the SceneStore without going through MCP.
//   3. A separate `/events` SSE stream that broadcasts `scene` snapshots
//      whenever the store mutates — this is what the Canvas panel
//      subscribes to in PR #13.
//
// `GET /healthz` is provided for integration tests and the Tauri sidecar
// readiness probe.
//
// See docs/05-mcp-server.md (PR #11, SSE transport section).

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { Primitive, PrimitiveId, Theme } from '@drawcast/core';
import type { DrawcastServer } from '../server.js';
import {
  createPreviewBus,
  type PreviewBus,
  type PreviewResponse,
} from '../preview-bus.js';
import { registerTools } from '../tools/index.js';

export interface SSEOptions {
  /** `'auto'` lets the OS pick an ephemeral port. */
  port: number | 'auto';
  /** Bind address; defaults to loopback-only. */
  host?: string;
  /**
   * Absolute session directory reported by `GET /healthz`. Purely
   * informational; PR #11 ships persistence but the HTTP server itself
   * doesn't touch it.
   */
  sessionPath?: string;
}

export interface SSEHandle {
  port: number;
  url: string;
  /** Gracefully shut down the HTTP server and all active SSE streams. */
  close(): Promise<void>;
  /**
   * Wait for a response keyed on `requestId` (posted by the app via
   * `/preview` or `/clipboard-ack`). Rejects on timeout with a clear
   * message. Wired in by PR #18 — exposed now so callers can plug tools
   * without an API break.
   */
  awaitResponse<T>(requestId: string, timeoutMs: number): Promise<T>;
  /**
   * Publish a custom event on the `/events` stream. For MVP the only use
   * is the automatic `scene` broadcast from the store listener, but
   * exposing this seam means future tools can push richer notifications
   * (e.g. `selection`) without another round of wiring.
   */
  emitEventToClients(kind: string, payload: unknown): void;
  /**
   * Number of `/events` subscribers currently attached. Callers use this
   * to short-circuit when they know nobody is listening (the preview bus
   * short-circuits `draw_get_preview` on zero subscribers).
   */
  eventSubscriberCount(): number;
  /**
   * Preview-pipeline bus. Registered with the `draw_get_preview` tool so
   * it can reach the `/events` stream + `/preview` reverse-channel.
   */
  previewBus: PreviewBus;
}

interface PendingResponse {
  resolve(value: unknown): void;
  reject(err: Error): void;
  timeout: NodeJS.Timeout;
}

interface SceneBroadcastPayload {
  primitives: Primitive[];
  theme: string;
  selection: readonly PrimitiveId[];
  locked: PrimitiveId[];
}

const DEFAULT_HOST = '127.0.0.1';

export async function startSSE(
  server: DrawcastServer,
  options: SSEOptions,
): Promise<SSEHandle> {
  const host = options.host ?? DEFAULT_HOST;
  const requestedPort = options.port === 'auto' ? 0 : options.port;

  // Map of active MCP-over-SSE transports keyed by sessionId so POST
  // /messages can route incoming JSON-RPC to the right stream.
  const mcpTransports = new Map<string, SSEServerTransport>();
  // Event-stream clients connected to `/events` (the custom scene broadcast
  // channel). Separate from MCP transports so the SDK framing stays clean.
  const eventClients = new Set<http.ServerResponse>();
  // Pending requestId -> resolver map for preview/clipboard round-trips.
  const pending = new Map<string, PendingResponse>();

  const httpServer = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      process.stderr.write(
        `[drawcast-mcp] sse request error: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
      } else if (!res.writableEnded) {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      httpServer.off('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      httpServer.off('error', onError);
      resolve();
    };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(requestedPort, host);
  });

  const addr = httpServer.address() as AddressInfo;
  const port = addr.port;
  const url = `http://${host}:${port}`;

  // Subscribe to store changes and rebroadcast to `/events` clients.
  const unsubscribe = server.store.onChange(() => {
    broadcastScene();
  });

  function broadcastScene(): void {
    if (eventClients.size === 0) {
      return;
    }
    emitToEventClients('scene', buildSceneSnapshot(server));
  }

  function emitToEventClients(kind: string, payload: unknown): void {
    const encoded = `event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of eventClients) {
      if (!client.writableEnded) {
        client.write(encoded);
      }
    }
  }

  async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const method = req.method ?? 'GET';
    const parsedUrl = new URL(req.url ?? '/', `http://${host}:${port}`);
    const pathname = parsedUrl.pathname;

    // The Tauri webview calls us from http://localhost:1420 in dev and
    // tauri://localhost (or https://tauri.localhost on Windows) in prod, so
    // reflect the requesting Origin. Server binds to 127.0.0.1 already, so
    // this is as restrictive as the network surface.
    const origin = req.headers.origin ?? '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === 'GET' && pathname === '/healthz') {
      return respondJSON(res, 200, {
        ok: true,
        port,
        ...(options.sessionPath !== undefined && {
          scenePath: options.sessionPath,
        }),
      });
    }

    if (method === 'GET' && pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      mcpTransports.set(transport.sessionId, transport);
      transport.onclose = (): void => {
        mcpTransports.delete(transport.sessionId);
      };
      await server.server.connect(transport);
      return;
    }

    if (method === 'POST' && pathname === '/messages') {
      const sessionId = parsedUrl.searchParams.get('sessionId');
      if (sessionId === null) {
        return respondJSON(res, 400, { error: 'Missing sessionId' });
      }
      const transport = mcpTransports.get(sessionId);
      if (transport === undefined) {
        return respondJSON(res, 404, { error: 'Unknown sessionId' });
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    if (method === 'GET' && pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // Nudge clients to keep the connection open.
      res.write(': connected\n\n');
      eventClients.add(res);
      // Prime with the current scene snapshot so the UI can hydrate
      // without a second roundtrip.
      const snapshot = buildSceneSnapshot(server);
      res.write(`event: scene\ndata: ${JSON.stringify(snapshot)}\n\n`);
      req.on('close', () => {
        eventClients.delete(res);
      });
      return;
    }

    if (method === 'POST' && pathname === '/selection') {
      const body = await readJSONBody(req);
      if (!isSelectionBody(body)) {
        return respondJSON(res, 400, { error: 'Invalid body' });
      }
      server.store.setSelection(body.ids as PrimitiveId[]);
      return respondJSON(res, 200, { ok: true });
    }

    if (method === 'POST' && pathname === '/edit-lock') {
      const body = await readJSONBody(req);
      if (!isEditLockBody(body)) {
        return respondJSON(res, 400, { error: 'Invalid body' });
      }
      const ids = body.ids as PrimitiveId[];
      if (body.locked) {
        server.store.lock(ids);
      } else {
        server.store.unlock(ids);
      }
      return respondJSON(res, 200, { ok: true });
    }

    if (method === 'POST' && pathname === '/preview') {
      const body = await readJSONBody(req);
      if (!isPreviewBody(body)) {
        return respondJSON(res, 400, { error: 'Invalid body' });
      }
      const entry = pending.get(body.requestId);
      if (entry === undefined) {
        return respondJSON(res, 404, { error: 'Unknown requestId' });
      }
      pending.delete(body.requestId);
      clearTimeout(entry.timeout);
      entry.resolve({
        data: body.data,
        mimeType: body.mimeType ?? 'image/png',
      });
      return respondJSON(res, 200, { ok: true });
    }

    if (method === 'POST' && pathname === '/clipboard-ack') {
      const body = await readJSONBody(req);
      if (!isClipboardAckBody(body)) {
        return respondJSON(res, 400, { error: 'Invalid body' });
      }
      const entry = pending.get(body.requestId);
      if (entry === undefined) {
        return respondJSON(res, 404, { error: 'Unknown requestId' });
      }
      pending.delete(body.requestId);
      clearTimeout(entry.timeout);
      if (body.ok) {
        entry.resolve({ ok: true });
      } else {
        entry.reject(new Error(body.error ?? 'Clipboard copy failed'));
      }
      return respondJSON(res, 200, { ok: true });
    }

    return respondJSON(res, 404, { error: 'Not found' });
  }

  // Build the preview bus against the hooks above so `draw_get_preview`
  // can reach into the SSE plumbing without knowing HTTP details. We
  // re-register tools with this bus as deps so the preview tool sees it
  // when dispatched through `tools/call`.
  const previewBus = createPreviewBus({
    emitEvent: (kind, payload): void => emitToEventClients(kind, payload),
    awaitResponse: (requestId, timeoutMs): Promise<PreviewResponse> =>
      awaitResponseImpl<PreviewResponse>(requestId, timeoutMs),
    hasSubscribers: (): boolean => eventClients.size > 0,
  });
  registerTools(server.server, server.store, server.tools, { previewBus });

  function awaitResponseImpl<T>(
    requestId: string,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`awaitResponse timeout for ${requestId}`));
      }, timeoutMs);
      timeout.unref?.();
      pending.set(requestId, {
        resolve: (value) => {
          resolve(value as T);
        },
        reject,
        timeout,
      });
    });
  }

  const handle: SSEHandle = {
    port,
    url,
    previewBus,
    async close(): Promise<void> {
      unsubscribe();
      // Reject outstanding waiters so callers don't hang on shutdown.
      for (const [, entry] of pending) {
        clearTimeout(entry.timeout);
        entry.reject(new Error('SSE server shutting down'));
      }
      pending.clear();
      // End event-stream clients so Node can close the underlying sockets.
      for (const client of eventClients) {
        if (!client.writableEnded) {
          client.end();
        }
      }
      eventClients.clear();
      for (const transport of mcpTransports.values()) {
        await transport.close().catch(() => undefined);
      }
      mcpTransports.clear();
      await new Promise<void>((resolve) => {
        httpServer.close(() => {
          resolve();
        });
        httpServer.closeAllConnections?.();
      });
    },
    awaitResponse<T>(requestId: string, timeoutMs: number): Promise<T> {
      return awaitResponseImpl<T>(requestId, timeoutMs);
    },
    emitEventToClients(kind: string, payload: unknown): void {
      emitToEventClients(kind, payload);
    },
    eventSubscriberCount(): number {
      return eventClients.size;
    },
  };

  return handle;
}

// TODO(PR#13 or later): enrich `/events` with incremental diffs + richer
// event kinds (selection, lock, theme). For PR #11 we always send the full
// scene snapshot.

function buildSceneSnapshot(server: DrawcastServer): SceneBroadcastPayload {
  const scene = server.store.getScene();
  const primitives = [...scene.primitives.values()];
  const theme: Theme = scene.theme;
  const locked = primitives.filter((p) => server.store.isLocked(p.id)).map((p) => p.id);
  return {
    primitives,
    theme: theme.name,
    selection: server.store.getSelection(),
    locked,
  };
}

async function readJSONBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  const MAX = 4 * 1024 * 1024; // 4MB safety cap; preview uploads fit easily
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    total += buf.length;
    if (total > MAX) {
      throw new Error('Request body too large');
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function respondJSON(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  if (res.writableEnded) {
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload).toString(),
  });
  res.end(payload);
}

// -----------------------------------------------------------------------------
// Body validators — permissive-but-correct, avoid `any`.
// -----------------------------------------------------------------------------

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isSelectionBody(body: unknown): body is { ids: string[] } {
  return (
    typeof body === 'object' &&
    body !== null &&
    isStringArray((body as { ids?: unknown }).ids)
  );
}

function isEditLockBody(
  body: unknown,
): body is { ids: string[]; locked: boolean } {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  const cast = body as { ids?: unknown; locked?: unknown };
  return isStringArray(cast.ids) && typeof cast.locked === 'boolean';
}

function isPreviewBody(
  body: unknown,
): body is { requestId: string; data: string; mimeType?: string } {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  const cast = body as {
    requestId?: unknown;
    data?: unknown;
    mimeType?: unknown;
  };
  return (
    typeof cast.requestId === 'string' &&
    typeof cast.data === 'string' &&
    (cast.mimeType === undefined || typeof cast.mimeType === 'string')
  );
}

function isClipboardAckBody(
  body: unknown,
): body is { requestId: string; ok: boolean; error?: string } {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  const cast = body as {
    requestId?: unknown;
    ok?: unknown;
    error?: unknown;
  };
  return (
    typeof cast.requestId === 'string' &&
    typeof cast.ok === 'boolean' &&
    (cast.error === undefined || typeof cast.error === 'string')
  );
}
