// `draw_upsert_frame` tool — add or update a framed region containing child
// primitives. Corresponds to the `Frame` primitive in `@drawcast/core`.
// See docs/05-mcp-server.md (PR #10, structural primitives).

import { z } from 'zod';
import type { Frame, PrimitiveId } from '@drawcast/core';
import { SceneLockError } from '../store.js';
import { lockErrorMessage } from './errors.js';
import {
  defineTool,
  type ToolContentBlock,
  type ToolExecutionResult,
} from './types.js';
import {
  POINT_JSON_SCHEMA,
  PointSchema,
  RETURN_PREVIEW_JSON_SCHEMA,
  ReturnPreviewSchema,
  SIZE_JSON_SCHEMA,
  SizeSchema,
  formatZodError,
  normalizeReturnPreview,
} from './utils.js';
import { requestScenePreview } from './helpers/preview.js';
import { sanitizeLabelText } from './helpers/textSanitize.js';

export const drawUpsertFrameInputSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  at: PointSchema,
  size: SizeSchema,
  children: z.array(z.string().min(1)),
  magic: z.boolean().optional(),
  angle: z.number().optional(),
  locked: z.boolean().optional(),
  opacity: z.number().min(0).max(100).optional(),
  returnPreview: ReturnPreviewSchema,
});

export type DrawUpsertFrameInput = z.infer<typeof drawUpsertFrameInputSchema>;

const DESCRIPTION =
  'Add or update a framed region that visually contains a set of child primitives. Useful for swimlanes, slide-like partitions, or labelled sub-diagrams. Children are referenced by primitive id. Pass `returnPreview: true` to receive a PNG snapshot of the scene after the upsert for visual self-review.';

export const drawUpsertFrame = defineTool({
  name: 'draw_upsert_frame',
  description: DESCRIPTION,
  inputSchema: drawUpsertFrameInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Stable identifier for upsert' },
      title: { type: 'string', description: 'Optional frame label' },
      at: {
        ...POINT_JSON_SCHEMA,
        description: 'Scene coordinate [x, y] of the frame top-left corner',
      },
      size: {
        ...SIZE_JSON_SCHEMA,
        description: '[width, height] of the frame',
      },
      children: {
        type: 'array',
        items: { type: 'string' },
        description: 'Primitive ids that belong inside this frame',
      },
      magic: {
        type: 'boolean',
        description: 'Mark as a Magic Frame (Excalidraw AI)',
      },
      angle: { type: 'number', description: 'Rotation in degrees' },
      locked: { type: 'boolean' },
      opacity: { type: 'number', description: '0-100' },
      returnPreview: RETURN_PREVIEW_JSON_SCHEMA,
    },
    required: ['id', 'at', 'size', 'children'],
  },
  async execute(rawArgs, store, deps): Promise<ToolExecutionResult> {
    const parsed = drawUpsertFrameInputSchema.safeParse(rawArgs);
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

    const frame: Frame = {
      kind: 'frame',
      id: args.id as PrimitiveId,
      at: [args.at[0], args.at[1]],
      size: [args.size[0], args.size[1]] as const,
      children: args.children.map((c) => c as PrimitiveId),
      ...(args.title !== undefined && { title: sanitizeLabelText(args.title) }),
      ...(args.magic !== undefined && { magic: args.magic }),
      ...(args.angle !== undefined && { angle: args.angle }),
      ...(args.locked !== undefined && { locked: args.locked }),
      ...(args.opacity !== undefined && { opacity: args.opacity }),
    };

    try {
      store.upsert(frame);
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
      {
        type: 'text',
        text: `\u2713 frame ${args.id} upserted (${args.children.length} children)`,
      },
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
