// Browser-side MCP client: subscribes to `/events` over SSE and pushes
// reverse-channel POSTs (`/selection`, `/preview`, `/clipboard-ack`,
// `/edit-lock`). Pure browser HTTP — no Tauri APIs here. See
// docs/06-app-shell.md §171-236 and docs/05-mcp-server.md for the endpoint
// contracts.
//
// Connection model:
//   - `connect()` opens an EventSource. On error the server side is often
//     just still starting, so we retry with exponential backoff capped at
//     10 s. A successful reopen is signalled via `onConnectionChange(true)`.
//   - `disconnect()` is idempotent and cancels any pending retry.
//   - The MCP server emits `event: scene` frames on `/events`. We also
//     keep a fallback `message`-event parser so a minimally-compliant
//     server (no named events) still populates the UI.
//
// This module is intentionally framework-agnostic; see `useMcpClient`
// for the React binding.

import type { Primitive } from '@drawcast/core';

export interface SceneSnapshot {
  primitives: Primitive[];
  theme: string;
  selection: string[];
  locked: string[];
}

export type PreviewRequest = { requestId: string };
export type ClipboardRequest = {
  requestId: string;
  format: 'png' | 'excalidraw';
};

export interface McpClient {
  readonly baseUrl: string;
  connect(): void;
  disconnect(): void;
  postSelection(ids: readonly string[]): Promise<void>;
  postEditLock(ids: readonly string[], locked: boolean): Promise<void>;
  postClipboardAck(
    requestId: string,
    ok: boolean,
    error?: string,
  ): Promise<void>;
  postPreview(
    requestId: string,
    data: string,
    mimeType: string,
  ): Promise<void>;
  onScene(cb: (snapshot: SceneSnapshot) => void): () => void;
  onRequestPreview(cb: (req: PreviewRequest) => void): () => void;
  onRequestClipboard(cb: (req: ClipboardRequest) => void): () => void;
  onConnectionChange(cb: (connected: boolean) => void): () => void;
}

const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

type Listener<T> = (value: T) => void;

function emit<T>(listeners: Set<Listener<T>>, value: T): void {
  for (const cb of listeners) {
    try {
      cb(value);
    } catch (err) {
      // A bad subscriber should not take down the bus.
      // eslint-disable-next-line no-console
      console.error('[mcp-client] listener threw', err);
    }
  }
}

function subscribe<T>(
  listeners: Set<Listener<T>>,
  cb: Listener<T>,
): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function isSceneSnapshot(value: unknown): value is SceneSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<SceneSnapshot>;
  return (
    Array.isArray(v.primitives) &&
    typeof v.theme === 'string' &&
    Array.isArray(v.selection) &&
    Array.isArray(v.locked)
  );
}

function normalizeSnapshot(value: unknown): SceneSnapshot | null {
  if (!isSceneSnapshot(value)) return null;
  return {
    primitives: value.primitives,
    theme: value.theme,
    selection: value.selection,
    locked: value.locked,
  };
}

export function createMcpClient(port: number, host?: string): McpClient {
  const baseUrl = `http://${host ?? '127.0.0.1'}:${port}`;

  const sceneListeners = new Set<Listener<SceneSnapshot>>();
  const previewListeners = new Set<Listener<PreviewRequest>>();
  const clipboardListeners = new Set<Listener<ClipboardRequest>>();
  const connListeners = new Set<Listener<boolean>>();

  let es: EventSource | null = null;
  let retryHandle: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let connected = false;
  let closed = false;

  function setConnected(next: boolean): void {
    if (next === connected) return;
    connected = next;
    emit(connListeners, next);
  }

  function scheduleRetry(): void {
    if (closed) return;
    if (retryHandle !== null) return;
    const delay = Math.min(
      MAX_BACKOFF_MS,
      MIN_BACKOFF_MS * 2 ** Math.min(attempt, 5),
    );
    attempt += 1;
    retryHandle = setTimeout(() => {
      retryHandle = null;
      openStream();
    }, delay);
  }

  function handleScenePayload(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // eslint-disable-next-line no-console
      console.warn('[mcp-client] non-JSON scene payload', raw);
      return;
    }
    const snap = normalizeSnapshot(parsed);
    if (snap !== null) emit(sceneListeners, snap);
  }

  function openStream(): void {
    if (closed) return;
    // Close any lingering EventSource before reopening.
    if (es !== null) {
      es.close();
      es = null;
    }
    const source = new EventSource(`${baseUrl}/events`);
    es = source;

    source.onopen = (): void => {
      attempt = 0;
      setConnected(true);
    };
    source.onerror = (): void => {
      // EventSource fires onerror both for transient failures and hard
      // disconnects; treat any error as "assume disconnected" and retry.
      setConnected(false);
      source.close();
      if (es === source) {
        es = null;
      }
      scheduleRetry();
    };

    source.addEventListener('scene', (evt: MessageEvent<string>) => {
      handleScenePayload(evt.data);
    });
    source.addEventListener(
      'requestPreview',
      (evt: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(evt.data) as { requestId?: unknown };
          if (typeof parsed.requestId === 'string') {
            emit(previewListeners, { requestId: parsed.requestId });
          }
        } catch {
          /* ignore */
        }
      },
    );
    source.addEventListener(
      'requestClipboard',
      (evt: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(evt.data) as {
            requestId?: unknown;
            format?: unknown;
          };
          if (
            typeof parsed.requestId === 'string' &&
            (parsed.format === 'png' || parsed.format === 'excalidraw')
          ) {
            emit(clipboardListeners, {
              requestId: parsed.requestId,
              format: parsed.format,
            });
          }
        } catch {
          /* ignore */
        }
      },
    );

    // Fallback: some EventSource clients surface unnamed payloads via the
    // default `message` handler even when the server used `event: scene`.
    // Parse as a scene if it walks like one.
    source.onmessage = (evt: MessageEvent<string>): void => {
      handleScenePayload(evt.data);
    };
  }

  async function postJSON(path: string, body: unknown): Promise<void> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Pull a best-effort error body for the thrown message.
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      throw new Error(
        `POST ${path} failed: ${res.status} ${res.statusText}${
          detail ? ` — ${detail}` : ''
        }`,
      );
    }
  }

  return {
    baseUrl,
    connect(): void {
      closed = false;
      if (es !== null) return;
      openStream();
    },
    disconnect(): void {
      closed = true;
      if (retryHandle !== null) {
        clearTimeout(retryHandle);
        retryHandle = null;
      }
      if (es !== null) {
        es.close();
        es = null;
      }
      setConnected(false);
    },
    postSelection(ids: readonly string[]): Promise<void> {
      return postJSON('/selection', { ids: [...ids] });
    },
    postEditLock(ids: readonly string[], locked: boolean): Promise<void> {
      return postJSON('/edit-lock', { ids: [...ids], locked });
    },
    postClipboardAck(
      requestId: string,
      ok: boolean,
      error?: string,
    ): Promise<void> {
      const body: Record<string, unknown> = { requestId, ok };
      if (error !== undefined) body['error'] = error;
      return postJSON('/clipboard-ack', body);
    },
    postPreview(
      requestId: string,
      data: string,
      mimeType: string,
    ): Promise<void> {
      return postJSON('/preview', { requestId, data, mimeType });
    },
    onScene(cb) {
      return subscribe(sceneListeners, cb);
    },
    onRequestPreview(cb) {
      return subscribe(previewListeners, cb);
    },
    onRequestClipboard(cb) {
      return subscribe(clipboardListeners, cb);
    },
    onConnectionChange(cb) {
      return subscribe(connListeners, cb);
    },
  };
}
