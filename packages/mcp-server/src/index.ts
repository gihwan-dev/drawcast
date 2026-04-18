import { Server } from '@modelcontextprotocol/sdk/server/index.js';

export function createServer(): Server {
  return new Server(
    { name: 'drawcast-mcp', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
}
