// Placeholder for the preview-request path. PR #18 will implement
// `handlePreviewRequest` against the Excalidraw imperative API and upload
// the rendered PNG to `POST /preview`. For PR #13 we acknowledge the
// request with an empty payload so the server's awaitResponse doesn't
// hang. The real rendering path lands alongside the clipboard/export
// plumbing.

import type { McpClient, PreviewRequest } from './client.js';

export async function handlePreviewRequest(
  client: McpClient,
  _api: unknown,
  req: PreviewRequest,
): Promise<void> {
  // TODO(PR#18): replace with a real PNG render from the Excalidraw API.
  // A 1x1 transparent PNG keeps the payload shape valid without bloating
  // the message.
  const transparentPixel =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';
  await client.postPreview(req.requestId, transparentPixel, 'image/png');
}
