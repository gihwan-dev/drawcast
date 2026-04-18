// MCP server wiring.
//
// Constructs a `@modelcontextprotocol/sdk` `Server` instance with a
// `SceneStore` backing it. This PR registers the minimum handlers required
// for the MCP handshake (initialize → tools/list → empty list). The actual
// tool implementations land in PR #9/#10; until then, `tools/call` throws a
// clear error so any mistaken invocation fails loudly.
//
// See docs/05-mcp-server.md.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { SceneStore } from './store.js';

export interface CreateServerOptions {
  name?: string;
  version?: string;
  /**
   * Inject a pre-existing {@link SceneStore}. Useful when the caller (e.g. the
   * Tauri app in sidecar mode) wants to share one store across multiple
   * transports, or in tests.
   */
  store?: SceneStore;
}

export interface DrawcastServer {
  server: Server;
  store: SceneStore;
}

const DEFAULT_NAME = 'drawcast-mcp';
const DEFAULT_VERSION = '0.0.0';

export function createServer(options: CreateServerOptions = {}): DrawcastServer {
  const name = options.name ?? DEFAULT_NAME;
  const version = options.version ?? DEFAULT_VERSION;
  const store = options.store ?? new SceneStore();

  const server = new Server(
    { name, version },
    {
      capabilities: {
        // Declare tools capability so clients know we speak tools/* —
        // the actual list is empty until PR #9 registers handlers.
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: [] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // PR #9 will replace this with a real dispatch table. Until then, any
    // tools/call is a protocol error — the tool list is empty and the
    // client should not be calling anything.
    throw new Error(`Tool not found: ${request.params.name}`);
  });

  return { server, store };
}
