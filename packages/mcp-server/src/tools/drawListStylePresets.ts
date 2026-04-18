// `draw_list_style_presets` tool — tell the model which preset names are
// available so it can pass them as `style: "<name>"` on box/edge upserts
// without guessing. Returns node and edge preset names plus the active
// theme name. See docs/05-mcp-server.md (PR #10, scene queries).

import { z } from 'zod';
import { defineTool, type ToolExecutionResult } from './types.js';

export const drawListStylePresetsInputSchema = z.object({}).strict();
export type DrawListStylePresetsInput = z.infer<
  typeof drawListStylePresetsInputSchema
>;

const DESCRIPTION =
  'List the style preset names available under the active theme. Use this before passing a preset name to draw_upsert_box/draw_upsert_edge.';

export const drawListStylePresets = defineTool({
  name: 'draw_list_style_presets',
  description: DESCRIPTION,
  inputSchema: drawListStylePresetsInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(_rawArgs, store): Promise<ToolExecutionResult> {
    const theme = store.getTheme();
    const nodes = Object.keys(theme.nodes).sort();
    const edges = Object.keys(theme.edges).sort();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { theme: theme.name, nodes, edges },
            null,
            2,
          ),
        },
      ],
    };
  },
});
