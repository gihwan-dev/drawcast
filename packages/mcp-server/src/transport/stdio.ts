// stdio transport wrapper.
//
// Binds a `DrawcastServer` to the official MCP `StdioServerTransport`. Use
// this from the CLI when the server is being spawned as a subprocess by
// Claude Code / Codex CLI (single-tenant, single-client).
//
// The MCP protocol uses stdout as the JSON-RPC channel, so all logging must
// go to stderr. See docs/05-mcp-server.md (Logging section).

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { DrawcastServer } from '../server.js';

export async function connectStdio(server: DrawcastServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.server.connect(transport);
  // stdout is reserved for MCP JSON-RPC — the start line must go to stderr.
  process.stderr.write('[drawcast-mcp] stdio listening\n');
}
