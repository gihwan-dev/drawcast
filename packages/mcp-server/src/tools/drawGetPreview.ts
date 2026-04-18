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
// `draw_export` for the JSON scene.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineTool, type ToolExecutionResult } from './types.js';
import { formatZodError } from './utils.js';

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
  'Request a PNG preview of the current scene from the connected app. Returns base64-encoded image data. Requires the Drawcast desktop app to be running (headless MCP mode cannot generate previews — use draw_export for JSON instead).';

/**
 * Tool return shape. We emit an MCP `image` content block whose `data` is
 * the base64 payload the app uploaded. Clients that can render images
 * (Claude Code with vision) surface it directly; text-only clients see
 * the fallback string below.
 */
interface ImageContentBlock {
  type: 'image';
  data: string;
  mimeType: string;
}

interface TextContentBlock {
  type: 'text';
  text: string;
}

type PreviewContentBlock = ImageContentBlock | TextContentBlock;

interface PreviewToolResult {
  content: PreviewContentBlock[];
  isError?: boolean;
}

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
        description: 'Image format. PNG is lossless; JPEG is smaller.',
      },
      scale: {
        type: 'number',
        minimum: 1,
        maximum: 4,
        description: 'Render scale factor (1–4). 2 is the Retina default.',
      },
      timeoutMs: {
        type: 'number',
        minimum: 1000,
        maximum: 30000,
        description:
          'How long to wait for the app to reply, in milliseconds.',
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

    const bus = deps?.previewBus;
    if (bus === undefined) {
      // Standalone MCP mode: the CLI is talking to a bare stdio server
      // with no app attached. Preview requires a browser runtime to
      // render the canvas, so there is no fallback short of failing.
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Preview not available in headless MCP mode. The Drawcast desktop app must be running to render a PNG. Use draw_export to retrieve the scene as JSON instead.',
          },
        ],
      };
    }

    if (!bus.hasSubscribers()) {
      // Bus exists but nobody's listening on /events — the sidecar is up
      // but the desktop app hasn't opened its EventSource yet (or it
      // crashed). Fail fast so the model doesn't sit on the 10 s
      // timeout.
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Preview requested but no app is currently subscribed to the event stream. Launch the Drawcast app and retry.',
          },
        ],
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
        isError: true,
        content: [
          {
            type: 'text',
            text: `Preview request timed out after ${timeoutMs}ms: ${msg}`,
          },
        ],
      };
    }

    if (response.data.length === 0) {
      // The app acknowledged the round-trip but couldn't render. Flag as
      // error so the model doesn't hand the user an empty image.
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Preview render failed: the app returned an empty image payload.',
          },
        ],
      };
    }

    const result: PreviewToolResult = {
      content: [
        {
          type: 'image',
          data: response.data,
          mimeType: response.mimeType,
        },
      ],
    };
    // ToolExecutionResult's content type is narrowed to text-only in PR #9;
    // image blocks are a permissive extension the MCP SDK already accepts.
    return result as unknown as ToolExecutionResult;
  },
});
