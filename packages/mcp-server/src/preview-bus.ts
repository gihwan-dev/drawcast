// Preview pipeline bus.
//
// The `draw_get_preview` tool needs to reach out of the JSON-RPC call path
// into the SSE `/events` channel — emit a `requestPreview` event, then
// await the app's reply on `POST /preview`. Rather than hand the tool the
// entire SSE handle (which would bring the tool into transport-specific
// territory), we expose a small `PreviewBus` contract:
//
//   - `emitRequest(id, format, scale)` — push a `requestPreview` event.
//   - `awaitResponse(id, timeoutMs)`   — block until the app POSTs back,
//                                        rejecting on timeout.
//   - `hasSubscribers()`               — fast-fail path when no app is
//                                        listening (standalone MCP mode).
//
// The SSE transport constructs one of these and passes it to
// `createServer({ previewBus })`. In stdio mode `previewBus` is undefined
// and the tool returns a "headless" error so the model knows to suggest
// `draw_export` instead.
//
// See docs/07-session-and-ipc.md "Preview Pipeline" and
// docs/05-mcp-server.md (PR #18).

export interface PreviewResponse {
  /** Base64-encoded image payload. */
  data: string;
  /** MIME type — defaults to `image/png` on the transport side. */
  mimeType: string;
}

export interface PreviewBus {
  /**
   * Push a `requestPreview` event onto the `/events` stream so any app
   * subscribers can start rendering.
   */
  emitRequest(
    requestId: string,
    format: 'png' | 'jpeg',
    scale: number,
  ): void;
  /**
   * Wait for the app to POST `/preview` with the matching `requestId`.
   * Rejects with a timeout error if no reply arrives in time.
   */
  awaitResponse(
    requestId: string,
    timeoutMs: number,
  ): Promise<PreviewResponse>;
  /** Returns `true` when at least one `/events` subscriber is connected. */
  hasSubscribers(): boolean;
}

/**
 * Build a {@link PreviewBus} around a transport's `emitEvent` and
 * `awaitResponse` hooks. The SSE transport passes its own implementations
 * in — tests can pass mocks.
 */
export function createPreviewBus(opts: {
  emitEvent: (kind: string, payload: unknown) => void;
  awaitResponse: (
    requestId: string,
    timeoutMs: number,
  ) => Promise<PreviewResponse>;
  hasSubscribers: () => boolean;
}): PreviewBus {
  return {
    emitRequest(requestId, format, scale): void {
      opts.emitEvent('requestPreview', { requestId, format, scale });
    },
    awaitResponse(requestId, timeoutMs): Promise<PreviewResponse> {
      return opts.awaitResponse(requestId, timeoutMs);
    },
    hasSubscribers(): boolean {
      return opts.hasSubscribers();
    },
  };
}
