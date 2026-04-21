// MCP server wiring.
//
// Constructs a `@modelcontextprotocol/sdk` `Server` instance with a
// `SceneStore` backing it and installs the core tool handlers
// (`draw_upsert_box`, `draw_upsert_edge`, `draw_upsert_sticky`). Callers
// may override the tool set through `CreateServerOptions.tools` — tests
// use this to register stubs, and PR #10 will grow the default set.
//
// See docs/05-mcp-server.md.

import type { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SceneStore } from './store.js';
import { coreTools, registerTools } from './tools/index.js';
import type { ToolDefinition } from './tools/types.js';
import type { PreviewBus } from './preview-bus.js';

export interface CreateServerOptions {
  name?: string;
  version?: string;
  /**
   * Inject a pre-existing {@link SceneStore}. Useful when the caller (e.g. the
   * Tauri app in sidecar mode) wants to share one store across multiple
   * transports, or in tests.
   */
  store?: SceneStore;
  /**
   * Override the advertised tool set. Defaults to {@link coreTools}.
   * Primarily a test seam.
   */
  tools?: readonly ToolDefinition<z.ZodTypeAny>[];
  /**
   * Bus that lets tools (currently only `draw_get_preview`) talk back to
   * the SSE transport for request/response round-trips. Omit in stdio
   * mode — tools that need it will fail with an informative error.
   */
  previewBus?: PreviewBus;
}

export interface DrawcastServer {
  server: Server;
  store: SceneStore;
  tools: readonly ToolDefinition<z.ZodTypeAny>[];
}

const DEFAULT_NAME = 'drawcast-mcp';
const DEFAULT_VERSION = '0.0.0';

// Layout guidance surfaced via the MCP initialize `instructions` field.
// Clients (Claude Code, Codex) expose this to the drawing agent so it
// plans spacing and routing before issuing upserts. Keep terse — the
// agent re-reads it at every invocation.
const DEFAULT_INSTRUCTIONS = `You are drawing a diagram into a shared Excalidraw scene via draw_upsert_* tools. Follow these layout rules so the rendered result is readable:

1. Plan the grid before drawing. Pick a main-flow column (e.g. x=400) and branch columns ≥250px to the side (e.g. x=150 / x=650). Rows step by ≥140px (y=50, 190, 330, ...). Default box size is roughly 200×65, so adjacent box centers must stay ≥280px apart horizontally and ≥140px apart vertically to avoid overlap.
2. Route feedback / loop / cross-diagram edges with routing:"elbow" AND keep them in a dedicated outer lane ≥200px away from every main-flow box. Example: if the main column centers at x=400 with 200px-wide boxes (edges at x=300–500), put a left-side feedback lane at x ≤ 100 and a right-side lane at x ≥ 700. Leave room for the edge label on that lane (≥120px of clear space to the nearest box edge) so it does not collide with box borders or other edges. Never let a long edge cross over a non-endpoint node.
3. Keep edge labels short (≤8 chars, e.g. "예"/"아니오"/"success"/"fail"). Long labels collide with neighbouring boxes; move detail into the connected box's text instead.
4. Branches go in their own columns. For decision diamonds, place the "yes" child and "no" child in different columns at the same y row, then merge below if needed.
5. Upsert ids should be stable — re-upserting the same id repositions rather than duplicating. Prefer getting coordinates right the first time over iterative nudges.
6. End the session as soon as the diagram is complete. The host runner fetches the scene via draw_export automatically, so you do not need to call draw_export yourself unless asked.`;

export function createServer(options: CreateServerOptions = {}): DrawcastServer {
  const name = options.name ?? DEFAULT_NAME;
  const version = options.version ?? DEFAULT_VERSION;
  const store = options.store ?? new SceneStore();
  const tools = options.tools ?? coreTools;

  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
      },
      instructions: DEFAULT_INSTRUCTIONS,
    },
  );

  const deps =
    options.previewBus !== undefined
      ? { previewBus: options.previewBus }
      : undefined;
  registerTools(server, store, tools, deps);

  return { server, store, tools };
}
