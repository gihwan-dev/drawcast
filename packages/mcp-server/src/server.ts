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
}

export interface DrawcastServer {
  server: Server;
  store: SceneStore;
  tools: readonly ToolDefinition<z.ZodTypeAny>[];
}

const DEFAULT_NAME = 'drawcast-mcp';
const DEFAULT_VERSION = '0.0.0';

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
    },
  );

  registerTools(server, store, tools);

  return { server, store, tools };
}
