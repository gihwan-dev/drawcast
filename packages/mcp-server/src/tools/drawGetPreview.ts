// `draw_get_preview` tool — ask the connected Drawcast app to render the
// current scene to PNG / JPEG and return the base64-encoded bytes so a
// vision-capable model can inspect them.
//
// Shape of the round-trip (see docs/07-session-and-ipc.md, PR #18):
//
//   1. Tool mints a fresh `requestId`.
//   2. Bus emits `event: requestPreview` on the SSE `/events` stream.
//   3. App subscribes, calls `excalidrawAPI.exportToBlob`, POSTs `/preview`.
//   4. Bus `awaitResponse` resolves with `{data, mimeType}`.
//   5. Tool returns it as an MCP image content block (base64 data).
//
// The tool itself doesn't know about HTTP — it talks to a `PreviewBus`
// which the SSE transport provides. In stdio mode no bus is injected and
// we return an explicit `isError` telling the model to fall back on
// `draw_export` for the JSON scene. The round-trip logic lives in the
// shared `requestScenePreview` helper so the upsert tools' `returnPreview`
// option can reuse it.

import { z } from 'zod';
import { defineTool, type ToolExecutionResult } from './types.js';
import { formatZodError } from './utils.js';
import { requestScenePreview } from './helpers/preview.js';

export const drawGetPreviewInputSchema = z.object({
  format: z.enum(['png', 'jpeg']).default('png'),
  /** Retina / HiDPI multiplier. 2 matches the in-app snapshot default. */
  scale: z.number().min(1).max(4).default(2),
  /**
   * Maximum wait for the app reply. Keep the floor large enough to cover
   * cold-start exports (Excalidraw reflow + PNG encode) and capped so a
   * runaway preview can't pin the model's turn.
   */
  timeoutMs: z.number().min(1000).max(30_000).default(10_000),
});

export type DrawGetPreviewInput = z.infer<typeof drawGetPreviewInputSchema>;

const DESCRIPTION =
  'Render the current scene to PNG/JPEG and return it as a base64 image block for visual self-review. Use this liberally while drawing multi-step diagrams — after each batch of upserts, call this tool to verify layout and catch issues that scene JSON does not expose: overlapping primitives, off-grid alignment, cramped labels, edge routing errors, unbalanced whitespace, wrong arrow heads. Prefer this over re-reading the scene JSON whenever the problem is geometric rather than structural. Requires the Drawcast desktop app to be running; in headless MCP mode this is unavailable — use draw_export to retrieve JSON instead.';

export const drawGetPreview = defineTool({
  name: 'draw_get_preview',
  description: DESCRIPTION,
  inputSchema: drawGetPreviewInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['png', 'jpeg'],
        description:
          'Image format. PNG is lossless (recommended for self-review); JPEG is smaller (user-share).',
      },
      scale: {
        type: 'number',
        minimum: 1,
        maximum: 4,
        description:
          'Render scale factor (1-4). Default 2 (Retina). Bump to 3+ when inspecting small labels.',
      },
      timeoutMs: {
        type: 'number',
        minimum: 1000,
        maximum: 30000,
        description:
          'How long to wait for the app to reply, in milliseconds. Larger scenes need more time.',
      },
    },
    required: [],
  },
  async execute(rawArgs, _store, deps): Promise<ToolExecutionResult> {
    const parsed = drawGetPreviewInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Invalid input: ${formatZodError(parsed.error)}`,
          },
        ],
      };
    }
    const { format, scale, timeoutMs } = parsed.data;

    const result = await requestScenePreview(deps?.previewBus, {
      format,
      scale,
      timeoutMs,
    });
    if (result.ok) {
      return { content: [result.image] };
    }
    // For `draw_get_preview`, the preview IS the product — a missing image
    // is a hard failure. Upsert tools treat the same warning as a soft
    // degradation instead.
    return {
      isError: true,
      content: [{ type: 'text', text: result.warning }],
    };
  },
});
