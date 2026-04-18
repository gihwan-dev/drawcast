// `draw_upsert_box` tool — add or update a labeled box (rectangle, ellipse,
// diamond) in the scene. Corresponds to the `LabelBox` primitive in
// `@drawcast/core`. See docs/05-mcp-server.md (lines 154-215).

import { z } from 'zod';
import type { LabelBox, PrimitiveId } from '@drawcast/core';
import { SceneLockError } from '../store.js';
import { defineTool, type ToolExecutionResult } from './types.js';
import {
  FontFamilySchema,
  POINT_JSON_SCHEMA,
  PointSchema,
  SIZE_JSON_SCHEMA,
  SizeSchema,
  STYLE_REF_JSON_SCHEMA,
  StyleRefSchema,
  formatZodError,
  normalizeStyleRef,
} from './utils.js';

const ShapeSchema = z.enum(['rectangle', 'ellipse', 'diamond']);
const TextAlignSchema = z.enum(['left', 'center', 'right']);
const VerticalAlignSchema = z.enum(['top', 'middle', 'bottom']);
const FitSchema = z.enum(['auto', 'fixed']);

// Exported for tests that want to re-use the schema directly.
export const drawUpsertBoxInputSchema = z.object({
  id: z.string().min(1),
  text: z.string().optional(),
  shape: ShapeSchema.optional(),
  at: PointSchema,
  style: StyleRefSchema.optional(),
  fit: FitSchema.optional(),
  size: SizeSchema.optional(),
  rounded: z.boolean().optional(),
  textAlign: TextAlignSchema.optional(),
  verticalAlign: VerticalAlignSchema.optional(),
  fontSize: z.number().positive().optional(),
  fontFamily: FontFamilySchema.optional(),
  angle: z.number().optional(),
  locked: z.boolean().optional(),
  opacity: z.number().min(0).max(100).optional(),
});

export type DrawUpsertBoxInput = z.infer<typeof drawUpsertBoxInputSchema>;

const DESCRIPTION =
  'Add or update a labeled box in the current scene. Use this for nodes in a diagram (process, decision, data, etc.). Same id re-applies as an update (upsert). Size auto-fits to text unless fit="fixed" with explicit size.';

export const drawUpsertBox = defineTool({
  name: 'draw_upsert_box',
  description: DESCRIPTION,
  inputSchema: drawUpsertBoxInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Stable identifier for upsert' },
      text: { type: 'string', description: 'Text inside the box' },
      shape: {
        type: 'string',
        enum: ['rectangle', 'ellipse', 'diamond'],
        description: 'Shape kind (default "rectangle")',
      },
      at: {
        ...POINT_JSON_SCHEMA,
        description: 'Scene coordinate [x, y]',
      },
      style: STYLE_REF_JSON_SCHEMA,
      fit: {
        type: 'string',
        enum: ['auto', 'fixed'],
        description: 'auto fits text, fixed uses explicit size',
      },
      size: {
        ...SIZE_JSON_SCHEMA,
        description: 'Required when fit="fixed"',
      },
      rounded: { type: 'boolean' },
      textAlign: {
        type: 'string',
        enum: ['left', 'center', 'right'],
      },
      verticalAlign: {
        type: 'string',
        enum: ['top', 'middle', 'bottom'],
      },
      fontSize: { type: 'number' },
      fontFamily: {
        type: 'number',
        enum: [1, 2, 3, 5, 6, 7, 8, 9],
        description: '1=Virgil, 2=Helvetica, 3=Cascadia, 5=Excalifont, etc.',
      },
      angle: { type: 'number', description: 'Rotation in degrees' },
      locked: { type: 'boolean' },
      opacity: { type: 'number', description: '0–100' },
    },
    required: ['id', 'at'],
  },
  async execute(rawArgs, store): Promise<ToolExecutionResult> {
    const parsed = drawUpsertBoxInputSchema.safeParse(rawArgs);
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

    if (args.fit === 'fixed' && args.size === undefined) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Invalid input: fit="fixed" requires an explicit size [width, height].',
          },
        ],
      };
    }

    const box: LabelBox = {
      kind: 'labelBox',
      id: args.id as PrimitiveId,
      shape: args.shape ?? 'rectangle',
      at: [args.at[0], args.at[1]],
      ...(args.text !== undefined && { text: args.text }),
      ...(args.style !== undefined && { style: normalizeStyleRef(args.style) }),
      ...(args.fit !== undefined && { fit: args.fit }),
      ...(args.size !== undefined && {
        size: [args.size[0], args.size[1]] as const,
      }),
      ...(args.rounded !== undefined && { rounded: args.rounded }),
      ...(args.textAlign !== undefined && { textAlign: args.textAlign }),
      ...(args.verticalAlign !== undefined && {
        verticalAlign: args.verticalAlign,
      }),
      ...(args.fontSize !== undefined && { fontSize: args.fontSize }),
      ...(args.fontFamily !== undefined && { fontFamily: args.fontFamily }),
      ...(args.angle !== undefined && { angle: args.angle }),
      ...(args.locked !== undefined && { locked: args.locked }),
      ...(args.opacity !== undefined && { opacity: args.opacity }),
    };

    try {
      store.upsert(box);
    } catch (err) {
      if (err instanceof SceneLockError) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `${err.message} Call unlock before retrying.`,
            },
          ],
        };
      }
      throw err;
    }

    return {
      content: [
        { type: 'text', text: `\u2713 box ${args.id} upserted` },
      ],
    };
  },
});
