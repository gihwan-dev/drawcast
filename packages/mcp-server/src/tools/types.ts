// Tool definition scaffolding shared by every MCP tool.
//
// Each tool carries *both* a zod schema (used at call time to parse and
// narrow the untyped `arguments` object the client sends) and a hand-rolled
// JSON Schema object (used in the `tools/list` response so clients can
// surface the parameters to users). The duplication is deliberate: hand
// rolling is trivial at three tools, and it keeps the `tools/list` payload
// free of zod-to-json-schema artefacts. When the tool count grows we can
// revisit with a converter package.
//
// See docs/05-mcp-server.md (Tool Schema section).
//
// `Tool.inputSchema` in the MCP SDK is an object of the form:
//   { type: 'object', properties?: Record<string, unknown>, required?: string[] }
// We model that with `ToolInputJsonSchema` below.

import type { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { SceneStore } from '../store.js';

/**
 * Shape of the JSON Schema literal each tool exposes through `tools/list`.
 * Intentionally narrow — the MCP SDK only requires `type: 'object'` plus
 * `properties` / `required`; additional keywords (descriptions, enums) live
 * inside `properties`.
 */
export interface ToolInputJsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: readonly string[];
}

/**
 * Return shape of `ToolDefinition.execute`. `isError: true` signals the MCP
 * convention that the call reached the tool but failed — the client will
 * surface the `content` text to the model rather than treating the whole
 * request as a transport error.
 */
export interface ToolExecutionResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export interface ToolDefinition<I extends z.ZodTypeAny> {
  /** Tool name as advertised in `tools/list` (e.g. `draw_upsert_box`). */
  readonly name: string;
  /** Human-readable description surfaced to the model. */
  readonly description: string;
  /** Runtime validator for the `arguments` payload. */
  readonly inputSchema: I;
  /** JSON Schema literal returned in the `tools/list` payload. */
  readonly jsonSchema: ToolInputJsonSchema;
  /**
   * Convert this definition to the shape required by the MCP SDK's
   * `ListToolsResultSchema` — `{name, description, inputSchema}`.
   */
  asToolListItem(): Tool;
  /** Execute the tool against a store, returning MCP content. */
  execute(
    args: z.infer<I>,
    store: SceneStore,
  ): Promise<ToolExecutionResult>;
}

/**
 * Small factory that fills in `asToolListItem` so individual tool modules
 * can focus on their input shape + business logic.
 */
export function defineTool<I extends z.ZodTypeAny>(
  def: Omit<ToolDefinition<I>, 'asToolListItem'>,
): ToolDefinition<I> {
  return {
    ...def,
    asToolListItem(): Tool {
      // Cast is necessary because the SDK's `Tool.inputSchema` is typed as
      // a zod-inferred `ObjectSchema` with `$catchall<unknown>`. Our
      // hand-rolled literal conforms structurally.
      return {
        name: def.name,
        description: def.description,
        inputSchema: def.jsonSchema as unknown as Tool['inputSchema'],
      };
    },
  };
}
