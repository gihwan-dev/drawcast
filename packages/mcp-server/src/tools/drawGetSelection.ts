// `draw_get_selection` tool — report which primitive ids the user currently
// has selected in the connected Excalidraw canvas. Most useful when the
// user refers to primitives with demonstratives ("this box", "these").
// See docs/05-mcp-server.md (PR #10, scene queries).

import { z } from 'zod';
import { defineTool, type ToolExecutionResult } from './types.js';

export const drawGetSelectionInputSchema = z.object({}).strict();
export type DrawGetSelectionInput = z.infer<
  typeof drawGetSelectionInputSchema
>;

const DESCRIPTION =
  'Return the primitive ids the user currently has selected in Excalidraw. Call this when the user uses deictic phrases like "this box" or "these".';

export const drawGetSelection = defineTool({
  name: 'draw_get_selection',
  description: DESCRIPTION,
  inputSchema: drawGetSelectionInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(_rawArgs, store): Promise<ToolExecutionResult> {
    const selection = [...store.getSelection()];
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ selection }, null, 2),
        },
      ],
    };
  },
});
