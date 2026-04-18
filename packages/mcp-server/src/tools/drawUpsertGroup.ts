// `draw_upsert_group` tool — gather existing primitives into an Excalidraw
// group so they move as one. Corresponds to the `Group` primitive in
// `@drawcast/core`. See docs/05-mcp-server.md (PR #10, structural primitives).

import { z } from 'zod';
import type { Group, PrimitiveId } from '@drawcast/core';
import { SceneLockError } from '../store.js';
import { lockErrorMessage } from './errors.js';
import { defineTool, type ToolExecutionResult } from './types.js';
import { formatZodError } from './utils.js';

export const drawUpsertGroupInputSchema = z.object({
  id: z.string().min(1),
  children: z.array(z.string().min(1)),
  angle: z.number().optional(),
  locked: z.boolean().optional(),
  opacity: z.number().min(0).max(100).optional(),
});

export type DrawUpsertGroupInput = z.infer<typeof drawUpsertGroupInputSchema>;

const DESCRIPTION =
  'Gather existing primitives into a group so they move and copy as a unit. Children are referenced by primitive id; the group itself has no visual shape.';

export const drawUpsertGroup = defineTool({
  name: 'draw_upsert_group',
  description: DESCRIPTION,
  inputSchema: drawUpsertGroupInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Stable identifier for upsert' },
      children: {
        type: 'array',
        items: { type: 'string' },
        description: 'Primitive ids that belong to this group',
      },
      angle: { type: 'number', description: 'Rotation in degrees' },
      locked: { type: 'boolean' },
      opacity: { type: 'number', description: '0-100' },
    },
    required: ['id', 'children'],
  },
  async execute(rawArgs, store): Promise<ToolExecutionResult> {
    const parsed = drawUpsertGroupInputSchema.safeParse(rawArgs);
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

    const group: Group = {
      kind: 'group',
      id: args.id as PrimitiveId,
      children: args.children.map((c) => c as PrimitiveId),
      ...(args.angle !== undefined && { angle: args.angle }),
      ...(args.locked !== undefined && { locked: args.locked }),
      ...(args.opacity !== undefined && { opacity: args.opacity }),
    };

    try {
      store.upsert(group);
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
        {
          type: 'text',
          text: `\u2713 group ${args.id} upserted (${args.children.length} children)`,
        },
      ],
    };
  },
});
