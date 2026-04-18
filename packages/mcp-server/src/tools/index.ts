// Aggregates every MCP tool the server exposes.
//
// `coreTools` is the canonical list; `registerTools` wires a given set into
// a live `Server` instance. Tests can import individual tools directly to
// exercise them without booting the transport pair.

import type { z } from 'zod';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { SceneStore } from '../store.js';
import type { ToolDefinition, ToolDeps } from './types.js';
import { drawUpsertBox } from './drawUpsertBox.js';
import { drawUpsertEdge } from './drawUpsertEdge.js';
import { drawUpsertSticky } from './drawUpsertSticky.js';
import { drawUpsertGroup } from './drawUpsertGroup.js';
import { drawUpsertFrame } from './drawUpsertFrame.js';
import { drawUpsertShape } from './drawUpsertShape.js';
import { drawGetScene } from './drawGetScene.js';
import { drawGetPrimitive } from './drawGetPrimitive.js';
import { drawGetSelection } from './drawGetSelection.js';
import { drawListStylePresets } from './drawListStylePresets.js';
import { drawRemove } from './drawRemove.js';
import { drawClear } from './drawClear.js';
import { drawSetTheme } from './drawSetTheme.js';
import { drawExport } from './drawExport.js';
import { drawGetPreview } from './drawGetPreview.js';

export { drawUpsertBox } from './drawUpsertBox.js';
export { drawUpsertEdge } from './drawUpsertEdge.js';
export { drawUpsertSticky } from './drawUpsertSticky.js';
export { drawUpsertGroup } from './drawUpsertGroup.js';
export { drawUpsertFrame } from './drawUpsertFrame.js';
export { drawUpsertShape } from './drawUpsertShape.js';
export { drawGetScene } from './drawGetScene.js';
export { drawGetPrimitive } from './drawGetPrimitive.js';
export { drawGetSelection } from './drawGetSelection.js';
export { drawListStylePresets } from './drawListStylePresets.js';
export { drawRemove } from './drawRemove.js';
export { drawClear } from './drawClear.js';
export { drawSetTheme } from './drawSetTheme.js';
export { drawExport } from './drawExport.js';
export { drawGetPreview } from './drawGetPreview.js';
export { defineTool } from './types.js';
export type {
  ToolDefinition,
  ToolDeps,
  ToolExecutionResult,
  ToolInputJsonSchema,
} from './types.js';

/**
 * Canonical list of tools shipped with the MCP server — the full 15-tool
 * surface. PR #9 seeded this with the three upsert primitives; PR #10
 * completed the structural / query / mutation / theme / export tools; PR
 * #18 adds `draw_get_preview` for the preview pipeline.
 */
export const coreTools: readonly ToolDefinition<z.ZodTypeAny>[] = [
  drawUpsertBox,
  drawUpsertEdge,
  drawUpsertSticky,
  drawUpsertGroup,
  drawUpsertFrame,
  drawUpsertShape,
  drawGetScene,
  drawGetPrimitive,
  drawGetSelection,
  drawListStylePresets,
  drawRemove,
  drawClear,
  drawSetTheme,
  drawExport,
  drawGetPreview,
];

/**
 * Install `tools/list` and `tools/call` handlers for the provided tool set
 * on a server instance. Replaces any previously installed handler of the
 * same method — calling this more than once is safe.
 *
 * The optional `deps` bag threads transport-level capabilities (like the
 * preview-bus) into each tool's `execute` call. Tools that don't need them
 * (everything except `draw_get_preview` today) ignore the argument.
 */
export function registerTools(
  server: Server,
  store: SceneStore,
  tools: readonly ToolDefinition<z.ZodTypeAny>[],
  deps?: ToolDeps,
): void {
  const byName = new Map<string, ToolDefinition<z.ZodTypeAny>>();
  for (const tool of tools) {
    byName.set(tool.name, tool);
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((tool) => tool.asToolListItem()),
    };
  });

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<CallToolResult> => {
      const tool = byName.get(request.params.name);
      if (!tool) {
        // Unknown tool — surface as an `isError` content block rather than
        // throwing so the model can recover on its next turn.
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${request.params.name}`,
            },
          ],
        };
      }
      const args = request.params.arguments ?? {};
      // The tool's own `execute` handles zod validation + SceneLockError;
      // we just forward the raw args so it can build a single, uniform
      // error response.
      const result = await tool.execute(args, store, deps);
      return {
        content: result.content,
        ...(result.isError !== undefined && { isError: result.isError }),
      };
    },
  );
}
