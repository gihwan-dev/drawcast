// `draw_get_scene` tool — serialize the entire scene as JSON text for the
// model. Returns primitives as plain objects plus theme name, selection
// ids, and edit-lock ids. See docs/05-mcp-server.md (PR #10, scene queries).

import { z } from 'zod';
import type { Primitive } from '@drawcast/core';
import { defineTool, type ToolExecutionResult } from './types.js';

export const drawGetSceneInputSchema = z.object({}).strict();
export type DrawGetSceneInput = z.infer<typeof drawGetSceneInputSchema>;

const DESCRIPTION =
  'Return the current scene as JSON: primitives list, active theme name, user selection, and edit-locked ids. Call this before mutating an unknown scene.';

export const drawGetScene = defineTool({
  name: 'draw_get_scene',
  description: DESCRIPTION,
  inputSchema: drawGetSceneInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(_rawArgs, store): Promise<ToolExecutionResult> {
    const primitives: Primitive[] = store.getAllPrimitives();
    const theme = store.getTheme();
    const selection = [...store.getSelection()];
    // There's no public iterator for edit-locks — recover them by probing
    // every primitive id. Cheap (O(n)) and avoids leaking SceneStore internals.
    const locked = primitives
      .filter((p) => store.isLocked(p.id))
      .map((p) => p.id);

    const snapshot = {
      primitives,
      theme: { name: theme.name },
      selection,
      locked,
    };

    return {
      content: [
        { type: 'text', text: JSON.stringify(snapshot, null, 2) },
      ],
    };
  },
});
