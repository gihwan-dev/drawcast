// `draw_clear` tool — wipe every primitive in the scene. Gated behind an
// explicit `confirm: true` to prevent accidental destruction from the model.
// Theme and edit-lock state are left intact — only primitives are removed.
// See docs/05-mcp-server.md (PR #10, mutations).

import { z } from 'zod';
import { defineTool, type ToolExecutionResult } from './types.js';

export const drawClearInputSchema = z.object({
  confirm: z.boolean().optional(),
});

export type DrawClearInput = z.infer<typeof drawClearInputSchema>;

const DESCRIPTION =
  'Delete every primitive in the scene. Requires confirm:true to actually execute — without it the call returns isError so the model can prompt the user.';

export const drawClear = defineTool({
  name: 'draw_clear',
  description: DESCRIPTION,
  inputSchema: drawClearInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      confirm: {
        type: 'boolean',
        description: 'Must be true to actually clear the scene',
      },
    },
    required: [],
  },
  async execute(rawArgs, store): Promise<ToolExecutionResult> {
    const parsed = drawClearInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Invalid input: expected { confirm?: boolean }.',
          },
        ],
      };
    }
    const args = parsed.data;
    if (args.confirm !== true) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Refusing to clear the scene. Pass confirm: true to actually clear the scene.',
          },
        ],
      };
    }
    const before = store.getAllPrimitives().length;
    store.clear();
    return {
      content: [
        {
          type: 'text',
          text: `\u2713 cleared scene (${before} primitives removed)`,
        },
      ],
    };
  },
});
