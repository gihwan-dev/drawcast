// `draw_remove` tool — delete a single primitive from the scene.
// See docs/05-mcp-server.md (PR #10, mutations).

import { z } from 'zod';
import type { PrimitiveId } from '@drawcast/core';
import { defineTool, type ToolExecutionResult } from './types.js';
import { formatZodError } from './utils.js';

export const drawRemoveInputSchema = z.object({
  id: z.string().min(1),
});

export type DrawRemoveInput = z.infer<typeof drawRemoveInputSchema>;

const DESCRIPTION =
  'Delete a primitive by id. Returns isError when no such id exists so the model can recover.';

export const drawRemove = defineTool({
  name: 'draw_remove',
  description: DESCRIPTION,
  inputSchema: drawRemoveInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Primitive id to remove' },
    },
    required: ['id'],
  },
  async execute(rawArgs, store): Promise<ToolExecutionResult> {
    const parsed = drawRemoveInputSchema.safeParse(rawArgs);
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
    const existed = store.remove(id as PrimitiveId);
    if (!existed) {
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
      content: [{ type: 'text', text: `\u2713 removed ${id}` }],
    };
  },
});
