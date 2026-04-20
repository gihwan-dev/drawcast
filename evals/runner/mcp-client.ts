// Minimal MCP SSE client used by the runner to invoke `draw_export` after
// Claude finishes. Bypasses Claude's voluntary tool invocation so missing
// export calls no longer fail the attempt.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { ExcalidrawScene } from './types.js';

const CLIENT_NAME = 'drawcast-evals-runner';
const CLIENT_VERSION = '0.1.0';

export async function fetchSceneViaExport(
  sseUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<ExcalidrawScene> {
  const transport = new SSEClientTransport(new URL(sseUrl));
  const client = new Client(
    { name: CLIENT_NAME, version: CLIENT_VERSION },
    { capabilities: {} },
  );
  try {
    await client.connect(transport);
    const result = await client.callTool(
      {
        name: 'draw_export',
        arguments: { format: 'excalidraw' },
      },
      undefined,
      options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : undefined,
    );
    const scene = extractSceneFromResult(result);
    if (scene === undefined) {
      throw new Error('draw_export returned no parseable excalidraw envelope');
    }
    return scene;
  } finally {
    await client.close().catch(() => undefined);
  }
}

function extractSceneFromResult(result: unknown): ExcalidrawScene | undefined {
  if (result === null || typeof result !== 'object') return undefined;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (item === null || typeof item !== 'object') continue;
    const type = (item as { type?: unknown }).type;
    if (type !== 'text') continue;
    const text = (item as { text?: unknown }).text;
    if (typeof text !== 'string') continue;
    const scene = parseExcalidrawEnvelope(text);
    if (scene !== undefined) return scene;
  }
  return undefined;
}

function parseExcalidrawEnvelope(text: string): ExcalidrawScene | undefined {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return undefined;
  try {
    const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as unknown;
    if (isExcalidrawEnvelope(parsed)) return parsed;
  } catch {
    return undefined;
  }
  return undefined;
}

function isExcalidrawEnvelope(value: unknown): value is ExcalidrawScene {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.type === 'string' && Array.isArray(obj.elements);
}
