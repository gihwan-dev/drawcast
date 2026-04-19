// Shared helper that drives the `PreviewBus` round-trip used by both
// `draw_get_preview` and the upsert tools' `returnPreview` option.
//
// Design note: the helper **never** surfaces `isError: true`. A mutation
// tool that successfully wrote the store but failed to capture a preview
// is not a failed tool call — it's a degraded one. The caller composes
// the final result; helper only reports whether an image is available.
// `draw_get_preview` lifts `ok: false` into its own `isError` because
// preview *is* its product.

import { randomUUID } from 'node:crypto';
import type { PreviewBus } from '../../preview-bus.js';

export interface PreviewImageBlock {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface PreviewRequestOptions {
  format?: 'png' | 'jpeg';
  scale?: number;
  timeoutMs?: number;
}

export type PreviewRequestResult =
  | { ok: true; image: PreviewImageBlock }
  | { ok: false; warning: string };

const DEFAULTS = {
  format: 'png' as const,
  scale: 2,
  timeoutMs: 10_000,
};

/**
 * Ask the connected Drawcast app to render the current scene and return it
 * as an MCP image block. Returns a structured result so the caller can
 * decide whether a missing preview is a hard failure (dedicated tool) or
 * a soft one (attached to a successful mutation).
 *
 * Warning strings are carefully phrased so callers can either forward them
 * verbatim (as the upsert tools do) or rewrite them (as `draw_get_preview`
 * once did). The surface checked by existing tests:
 *   - /headless/i         → no bus injected (stdio mode)
 *   - /no app is currently subscribed/i → bus up, no `/events` listener
 *   - /timed out/i        → bus `awaitResponse` rejected
 */
export async function requestScenePreview(
  bus: PreviewBus | undefined,
  options: PreviewRequestOptions = {},
): Promise<PreviewRequestResult> {
  const format = options.format ?? DEFAULTS.format;
  const scale = options.scale ?? DEFAULTS.scale;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;

  if (bus === undefined) {
    return {
      ok: false,
      warning:
        'Preview skipped: headless MCP mode has no desktop app attached. Use draw_export for JSON instead.',
    };
  }

  if (!bus.hasSubscribers()) {
    return {
      ok: false,
      warning:
        'Preview skipped: no app is currently subscribed to the event stream. Launch the Drawcast app and retry.',
    };
  }

  const requestId = randomUUID();
  bus.emitRequest(requestId, format, scale);

  let response;
  try {
    response = await bus.awaitResponse(requestId, timeoutMs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      warning: `Preview timed out after ${timeoutMs}ms: ${msg}`,
    };
  }

  if (response.data.length === 0) {
    return {
      ok: false,
      warning:
        'Preview skipped: the app returned an empty image payload.',
    };
  }

  return {
    ok: true,
    image: {
      type: 'image',
      data: response.data,
      mimeType: response.mimeType,
    },
  };
}
