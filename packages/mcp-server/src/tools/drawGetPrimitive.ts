// `draw_get_primitive` tool — inspect a single primitive by id. Returns the
// primitive as JSON, or isError when no such id exists.
// See docs/05-mcp-server.md (PR #10, scene queries).

import { z } from 'zod';
import type { PrimitiveId } from '@drawcast/core';
import { defineTool, type ToolExecutionResult } from './types.js';
import { formatZodError } from './utils.js';

export const drawGetPrimitiveInputSchema = z.object({
  id: z.string().min(1),
});

export type DrawGetPrimitiveInput = z.infer<
  typeof drawGetPrimitiveInputSchema
>;

const DESCRIPTION =
  'Return a single primitive (by id) as JSON. Use when you need to inspect exact fields without pulling the full scene.';

export const drawGetPrimitive = defineTool({
  name: 'draw_get_primitive',
  description: DESCRIPTION,
  inputSchema: drawGetPrimitiveInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Primitive id to look up' },
    },
    required: ['id'],
  },
  async execute(rawArgs, store): Promise<ToolExecutionResult> {
    const parsed = drawGetPrimitiveInputSchema.safeParse(rawArgs);
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
    const { id } = parsed.data;
    const primitive = store.getPrimitive(id as PrimitiveId);
    if (primitive === undefined) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `No primitive with id "${id}" exists in the scene.`,
          },
        ],
      };
    }
    return {
      content: [
        { type: 'text', text: JSON.stringify(primitive, null, 2) },
      ],
    };
  },
});
