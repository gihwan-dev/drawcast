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
import type { ToolDefinition } from './types.js';
import { drawUpsertBox } from './drawUpsertBox.js';
import { drawUpsertEdge } from './drawUpsertEdge.js';
import { drawUpsertSticky } from './drawUpsertSticky.js';

export { drawUpsertBox } from './drawUpsertBox.js';
export { drawUpsertEdge } from './drawUpsertEdge.js';
export { drawUpsertSticky } from './drawUpsertSticky.js';
export { defineTool } from './types.js';
export type {
  ToolDefinition,
  ToolExecutionResult,
  ToolInputJsonSchema,
} from './types.js';

/**
 * Canonical list of tools shipped with the MCP server. PR #10 extends this
 * with the remaining twelve primitives / query / theme tools.
 */
export const coreTools: readonly ToolDefinition<z.ZodTypeAny>[] = [
  drawUpsertBox,
  drawUpsertEdge,
  drawUpsertSticky,
];

/**
 * Install `tools/list` and `tools/call` handlers for the provided tool set
 * on a server instance. Replaces any previously installed handler of the
 * same method — calling this more than once is safe.
 */
export function registerTools(
  server: Server,
  store: SceneStore,
  tools: readonly ToolDefinition<z.ZodTypeAny>[],
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
      const result = await tool.execute(args, store);
      return {
        content: result.content,
        ...(result.isError !== undefined && { isError: result.isError }),
      };
    },
  );
}
