// `draw_upsert_sticky` tool — add or update a free-floating text note.
// Corresponds to the `Sticky` primitive in `@drawcast/core`.
// See docs/05-mcp-server.md (lines 273-298).

import { z } from 'zod';
import type { PrimitiveId, Sticky } from '@drawcast/core';
import { SceneLockError } from '../store.js';
import { lockErrorMessage } from './errors.js';
import { defineTool, type ToolExecutionResult } from './types.js';
import {
  FontFamilySchema,
  POINT_JSON_SCHEMA,
  PointSchema,
  STYLE_REF_JSON_SCHEMA,
  StyleRefSchema,
  formatZodError,
  normalizeStyleRef,
} from './utils.js';

const TextAlignSchema = z.enum(['left', 'center', 'right']);

export const drawUpsertStickyInputSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  at: PointSchema,
  width: z.number().positive().optional(),
  style: StyleRefSchema.optional(),
  fontSize: z.number().positive().optional(),
  fontFamily: FontFamilySchema.optional(),
  textAlign: TextAlignSchema.optional(),
  angle: z.number().optional(),
  locked: z.boolean().optional(),
  opacity: z.number().min(0).max(100).optional(),
});

export type DrawUpsertStickyInput = z.infer<
  typeof drawUpsertStickyInputSchema
>;

const DESCRIPTION =
  'Add or update a free-floating text note (no container). Use for titles, annotations, legends. Multi-line text uses "\\n" separators.';

export const drawUpsertSticky = defineTool({
  name: 'draw_upsert_sticky',
  description: DESCRIPTION,
  inputSchema: drawUpsertStickyInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      text: { type: 'string' },
      at: {
        ...POINT_JSON_SCHEMA,
        description: 'Scene coordinate [x, y]',
      },
      width: {
        type: 'number',
        description: 'Force-wrap to this width (optional)',
      },
      style: STYLE_REF_JSON_SCHEMA,
      fontSize: { type: 'number' },
      fontFamily: {
        type: 'number',
        enum: [1, 2, 3, 5, 6, 7, 8, 9],
      },
      textAlign: {
        type: 'string',
        enum: ['left', 'center', 'right'],
      },
      angle: { type: 'number' },
      locked: { type: 'boolean' },
      opacity: { type: 'number' },
    },
    required: ['id', 'text', 'at'],
  },
  async execute(rawArgs, store): Promise<ToolExecutionResult> {
    const parsed = drawUpsertStickyInputSchema.safeParse(rawArgs);
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

    const sticky: Sticky = {
      kind: 'sticky',
      id: args.id as PrimitiveId,
      text: args.text,
      at: [args.at[0], args.at[1]],
      ...(args.width !== undefined && { width: args.width }),
      ...(args.style !== undefined && { style: normalizeStyleRef(args.style) }),
      ...(args.fontSize !== undefined && { fontSize: args.fontSize }),
      ...(args.fontFamily !== undefined && { fontFamily: args.fontFamily }),
      ...(args.textAlign !== undefined && { textAlign: args.textAlign }),
      ...(args.angle !== undefined && { angle: args.angle }),
      ...(args.locked !== undefined && { locked: args.locked }),
      ...(args.opacity !== undefined && { opacity: args.opacity }),
    };

    try {
      store.upsert(sticky);
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

    return {
      content: [
        { type: 'text', text: `\u2713 sticky ${args.id} upserted` },
      ],
    };
  },
});
