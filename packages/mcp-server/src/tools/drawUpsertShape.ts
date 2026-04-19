// `draw_upsert_shape` tool — dispatch-to-coverage-primitive helper.
//
// Rather than exposing four tiny tools (line/freedraw/image/embed), we fold
// them behind a single `kind` discriminator. Structure prompts the model to
// reach for `draw_upsert_box` / `draw_upsert_edge` first and pick this one
// only when the shape genuinely doesn't fit those.
//
// Per-kind zod schemas live in `drawUpsertShape.schemas.ts`; per-kind
// primitive builders live in `drawUpsertShape.builders.ts`. This keeps the
// tool definition focused on dispatch + error handling.
//
// See docs/05-mcp-server.md (PR #10, coverage primitive).

import { z } from 'zod';
import type { Embed, Freedraw, Image, Line } from '@drawcast/core';
import { SceneLockError } from '../store.js';
import { lockErrorMessage } from './errors.js';
import {
  defineTool,
  type ToolContentBlock,
  type ToolExecutionResult,
} from './types.js';
import {
  POINT_JSON_SCHEMA,
  RETURN_PREVIEW_JSON_SCHEMA,
  SIZE_JSON_SCHEMA,
  STYLE_REF_JSON_SCHEMA,
  formatZodError,
  normalizeReturnPreview,
} from './utils.js';
import { requestScenePreview } from './helpers/preview.js';
import {
  embedInputSchema,
  freedrawInputSchema,
  imageInputSchema,
  lineInputSchema,
} from './drawUpsertShape.schemas.js';
import {
  buildEmbed,
  buildFreedraw,
  buildImage,
  buildLine,
} from './drawUpsertShape.builders.js';

export const drawUpsertShapeInputSchema = z.discriminatedUnion('kind', [
  lineInputSchema,
  freedrawInputSchema,
  imageInputSchema,
  embedInputSchema,
]);

export type DrawUpsertShapeInput = z.infer<typeof drawUpsertShapeInputSchema>;

const DESCRIPTION =
  "Add or update a coverage primitive (line, freedraw, image, or embed). Use this for shapes that don't fit the box/edge/sticky model. Pass `returnPreview: true` to receive a PNG snapshot of the scene after the upsert for visual self-review.";

// Hand-rolled JSON Schema. We list every possible property (not all per-kind
// variants) because tools/list doesn't try to model the discriminated union
// — the zod schema is the real validator at call time.
const JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    id: { type: 'string', description: 'Stable identifier for upsert' },
    kind: {
      type: 'string',
      enum: ['line', 'freedraw', 'image', 'embed'],
      description: 'Which coverage primitive to build',
    },
    at: {
      ...POINT_JSON_SCHEMA,
      description: 'Scene-anchor coordinate [x, y]',
    },
    points: {
      type: 'array',
      items: POINT_JSON_SCHEMA,
      description: 'line/freedraw only: ordered [x, y] points',
    },
    dashed: { type: 'boolean', description: 'line only' },
    rounded: { type: 'boolean', description: 'line only' },
    polygon: { type: 'boolean', description: 'line only' },
    pressures: {
      type: 'array',
      items: { type: 'number' },
      description: 'freedraw only: per-point pressure (0..1)',
    },
    simulatePressure: { type: 'boolean', description: 'freedraw only' },
    size: {
      ...SIZE_JSON_SCHEMA,
      description: 'image/embed only: [width, height]',
    },
    source: {
      type: 'object',
      description:
        'image only: {kind:"path", path} or {kind:"data", dataURL, mimeType}',
    },
    crop: { type: 'object', description: 'image only: crop rectangle' },
    scale: {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
      description: 'image only: [sx, sy] flip factors',
    },
    url: { type: 'string', description: 'embed only: iframe URL' },
    validated: { type: 'boolean', description: 'embed only' },
    style: STYLE_REF_JSON_SCHEMA,
    angle: { type: 'number', description: 'Rotation in degrees' },
    locked: { type: 'boolean' },
    opacity: { type: 'number', description: '0-100' },
    returnPreview: RETURN_PREVIEW_JSON_SCHEMA,
  },
  required: ['id', 'kind', 'at'],
} as const;

export const drawUpsertShape = defineTool({
  name: 'draw_upsert_shape',
  description: DESCRIPTION,
  inputSchema: drawUpsertShapeInputSchema,
  jsonSchema: JSON_SCHEMA,
  async execute(rawArgs, store, deps): Promise<ToolExecutionResult> {
    const parsed = drawUpsertShapeInputSchema.safeParse(rawArgs);
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
    const args = parsed.data;

    let primitive: Line | Freedraw | Image | Embed;
    switch (args.kind) {
      case 'line':
        primitive = buildLine(args);
        break;
      case 'freedraw':
        primitive = buildFreedraw(args);
        break;
      case 'image':
        primitive = buildImage(args);
        break;
      case 'embed':
        primitive = buildEmbed(args);
        break;
    }

    try {
      store.upsert(primitive);
    } catch (err) {
      if (err instanceof SceneLockError) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: lockErrorMessage(err.primitiveId),
            },
          ],
        };
      }
      throw err;
    }

    const baseContent: ToolContentBlock[] = [
      { type: 'text', text: `\u2713 ${args.kind} ${args.id} upserted` },
    ];

    const previewOpts = normalizeReturnPreview(args.returnPreview);
    if (previewOpts === null) {
      return { content: baseContent };
    }
    const preview = await requestScenePreview(deps?.previewBus, previewOpts);
    if (preview.ok) {
      return { content: [...baseContent, preview.image] };
    }
    return {
      content: [
        ...baseContent,
        { type: 'text', text: `(${preview.warning})` },
      ],
    };
  },
});
