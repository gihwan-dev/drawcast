// Preview-request handler.
//
// The MCP server emits `requestPreview { requestId, format?, scale? }` on
// the `/events` SSE channel whenever `draw_get_preview` is invoked. This
// module owns the round-trip on the app side:
//
//   1. Pull the current scene from the Excalidraw imperative API.
//   2. Render a PNG (or JPEG) via `exportToBlob` at the requested scale.
//   3. Convert the blob to base64 and POST it to `/preview` via
//      `client.postPreview`.
//
// If the canvas isn't ready or `exportToBlob` throws, we still POST back
// with an empty data payload so the server's `awaitResponse` resolves and
// the tool can translate the failure into an `isError` (rather than
// letting it time out). That keeps the failure mode fast and explicit.
//
// See docs/07-session-and-ipc.md "Preview Pipeline" (PR #18).

import { exportToBlob } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types';
import type { McpClient, PreviewRequest } from './client.js';

/**
 * Optional fields the MCP server *will* send once PR #18's tool lands but
 * which PR #13's `PreviewRequest` type didn't model. We widen here so
 * today's stream is forward-compatible.
 */
export interface PreviewRequestDetail extends PreviewRequest {
  format?: 'png' | 'jpeg';
  scale?: number;
}

/**
 * Render the current scene to a base64 blob and POST it to `/preview`.
 *
 * `api` is the Excalidraw imperative API handle; passing `null` (or a stub
 * lacking the export methods) triggers the empty-payload failure path.
 */
export async function handlePreviewRequest(
  client: McpClient,
  api: ExcalidrawImperativeAPI | null,
  req: PreviewRequestDetail,
): Promise<void> {
  const format = req.format ?? 'png';
  const mimeType = `image/${format}`;

  if (api === null) {
    // No canvas attached — still ack so the server-side await doesn't
    // hang. The mcp-server tool treats empty data as an error.
    await client.postPreview(req.requestId, '', mimeType).catch(() => {
      /* swallow — client already logged */
    });
    return;
  }

  try {
    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const files = api.getFiles();
    const blob = await exportToBlob({
      elements,
      appState: {
        ...appState,
        exportScale: req.scale ?? 2,
      },
      files,
      mimeType,
      exportPadding: 16,
    });

    const base64 = await blobToBase64(blob);
    await client.postPreview(req.requestId, base64, mimeType);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[preview] render failed', err);
    // Ack with empty so the tool responds with an isError rather than
    // sitting on the 10s timeout.
    await client.postPreview(req.requestId, '', mimeType).catch(() => {
      /* swallow */
    });
  }
}

/**
 * Convert a Blob (PNG/JPEG bytes) to a base64 string. We read via
 * `arrayBuffer()` and walk the Uint8Array in chunks so larger previews
 * (~2–3 MB for a dense scene) don't blow the stack via
 * `String.fromCharCode(...new Uint8Array(buf))`.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // 32 KB chunks — keeps the argument list well under the
  // `String.fromCharCode.apply` argument-count ceiling on every engine.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    // Cast is necessary because TS models `fromCharCode` variadic param as
    // `number[]` — we hand it a typed-array view and the runtime accepts it.
    binary += String.fromCharCode.apply(
      null,
      slice as unknown as number[],
    );
  }
  return btoa(binary);
}
