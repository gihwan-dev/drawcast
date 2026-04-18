#!/usr/bin/env node
// CLI entry for `drawcast-mcp`.
//
// Modes (selected by argv):
//
//   drawcast-mcp              stdio mode (default). Logs to stderr.
//   drawcast-mcp --stdio      same as above, explicit.
//   drawcast-mcp --sse        HTTP + SSE mode. Prints DRAWCAST_PORT /
//                             DRAWCAST_READY markers to stdout; everything
//                             else goes to stderr so the Tauri sidecar can
//                             parse the markers line-by-line.
//   drawcast-mcp compile FILE Compile a JSON L2 scene spec and print the
//                             resulting .excalidraw envelope.
//   drawcast-mcp config register-cli {claude|codex}
//                             Register drawcast as an MCP server in the
//                             target CLI's user config.
//
// The parser is hand-rolled on purpose — yargs / commander would dwarf the
// surface area we actually need. Keep it linear and easy to read.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse as parseTOML, stringify as stringifyTOML } from 'smol-toml';
import {
  compile,
  serializeAsExcalidrawFile,
  sketchyTheme,
  cleanTheme,
  monoTheme,
  type Primitive,
  type PrimitiveId,
  type Scene,
  type Theme,
} from '@drawcast/core';
import {
  connectStdio,
  createServer,
  startSSE,
  ScenePersistence,
  VERSION,
  type SSEHandle,
} from './index.js';

const USAGE = `Usage: drawcast-mcp [command] [options]

Modes:
  (no args)                         Run stdio MCP server (default)
  --stdio                           Run stdio MCP server (explicit)
  --sse [--port N|auto]             Run HTTP+SSE MCP server
                                    [--session-path PATH]

Commands:
  compile <file.json>               Compile a JSON L2 spec to .excalidraw
  config register-cli <claude|codex>
                                    Register drawcast with the target CLI

Options:
  --port N|auto     Port for --sse mode (default: auto)
  --session-path P  Session directory for --sse mode
                    (default: ~/.drawcast/sessions/default)
  --help, -h        Show this help
  --version, -v     Print version
`;

interface ParsedArgs {
  mode:
    | { kind: 'stdio' }
    | { kind: 'sse'; port: number | 'auto'; sessionPath: string }
    | { kind: 'compile'; file: string }
    | { kind: 'register-cli'; target: 'claude' | 'codex' }
    | { kind: 'help' }
    | { kind: 'version' };
}

function defaultSessionPath(): string {
  return path.join(os.homedir(), '.drawcast', 'sessions', 'default');
}

function parseArgs(argv: readonly string[]): ParsedArgs | { error: string } {
  const args = argv.slice(2);

  if (args.length === 0) {
    return { mode: { kind: 'stdio' } };
  }

  if (args.includes('--help') || args.includes('-h')) {
    return { mode: { kind: 'help' } };
  }
  if (args.includes('--version') || args.includes('-v')) {
    return { mode: { kind: 'version' } };
  }

  const first = args[0];

  if (first === 'compile') {
    const file = args[1];
    if (typeof file !== 'string' || file.startsWith('-')) {
      return { error: 'compile requires a path argument' };
    }
    return { mode: { kind: 'compile', file } };
  }

  if (first === 'config') {
    const sub = args[1];
    if (sub !== 'register-cli') {
      return { error: `Unknown config subcommand: ${sub ?? '(none)'}` };
    }
    const target = args[2];
    if (target !== 'claude' && target !== 'codex') {
      return {
        error: `config register-cli requires "claude" or "codex" (got "${
          target ?? ''
        }")`,
      };
    }
    return { mode: { kind: 'register-cli', target } };
  }

  if (args.includes('--sse')) {
    let port: number | 'auto' = 'auto';
    let sessionPath = defaultSessionPath();
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--sse') continue;
      if (a === '--port') {
        const value = args[i + 1];
        if (value === undefined) {
          return { error: '--port requires a value' };
        }
        if (value === 'auto') {
          port = 'auto';
        } else {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
            return { error: `Invalid --port value: ${value}` };
          }
          port = parsed;
        }
        i += 1;
        continue;
      }
      if (a === '--session-path') {
        const value = args[i + 1];
        if (value === undefined) {
          return { error: '--session-path requires a value' };
        }
        sessionPath = value;
        i += 1;
        continue;
      }
      return { error: `Unknown argument: ${a}` };
    }
    return { mode: { kind: 'sse', port, sessionPath } };
  }

  // stdio mode with the flag spelled out.
  const unknown = args.filter((a) => a !== '--stdio');
  if (unknown.length > 0) {
    return { error: `Unknown arguments: ${unknown.join(' ')}` };
  }
  return { mode: { kind: 'stdio' } };
}

function themeByName(name: string): Theme {
  switch (name) {
    case 'sketchy':
      return sketchyTheme;
    case 'clean':
      return cleanTheme;
    case 'mono':
      return monoTheme;
    default:
      return sketchyTheme;
  }
}

async function runStdio(): Promise<void> {
  const drawcast = createServer();
  await connectStdio(drawcast);
}

async function runSse(options: {
  port: number | 'auto';
  sessionPath: string;
}): Promise<void> {
  await fs.mkdir(options.sessionPath, { recursive: true });

  const drawcast = createServer();
  const persistence = new ScenePersistence(drawcast.store, {
    sessionPath: options.sessionPath,
  });
  await persistence.loadIfExists();
  persistence.attach();

  let handle: SSEHandle;
  try {
    handle = await startSSE(drawcast, {
      port: options.port,
      sessionPath: options.sessionPath,
    });
  } catch (err) {
    persistence.dispose();
    throw err;
  }

  // Markers for the Tauri sidecar. stdout ONLY — stderr for everything else.
  process.stdout.write(`DRAWCAST_PORT=${handle.port}\n`);
  process.stdout.write('DRAWCAST_READY=1\n');
  process.stderr.write(
    `[drawcast-mcp] sse listening on ${handle.url} (session: ${options.sessionPath})\n`,
  );

  // Test helper: if set, shut down cleanly once the marker is out so
  // integration tests don't have to SIGTERM the child process.
  const fastExitMs = process.env.DRAWCAST_FAST_EXIT;
  if (fastExitMs !== undefined) {
    const delay = Number.parseInt(fastExitMs, 10);
    const ms = Number.isFinite(delay) && delay > 0 ? delay : 1500;
    setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          await persistence.flush();
        } catch {
          /* flush is best-effort on exit */
        }
        persistence.dispose();
        await handle.close();
        process.exit(0);
      })();
    }, ms).unref?.();
  }

  const shutdown = async (): Promise<void> => {
    try {
      await persistence.flush();
    } catch {
      /* best-effort */
    }
    persistence.dispose();
    await handle.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

async function runCompile(file: string): Promise<void> {
  const ext = path.extname(file).toLowerCase();
  if (ext !== '.json') {
    throw new Error(
      'Only JSON L2 specs supported; TypeScript spec runner coming in future PR',
    );
  }
  const raw = await fs.readFile(file, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(
      `Failed to parse ${file}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Expected object with { primitives, theme? } keys');
  }
  const cast = parsed as { primitives?: unknown; theme?: unknown };
  if (!Array.isArray(cast.primitives)) {
    throw new Error('Expected primitives: Primitive[]');
  }
  const primitives = cast.primitives as Primitive[];
  const themeName = typeof cast.theme === 'string' ? cast.theme : 'sketchy';
  const theme = themeByName(themeName);

  const map = new Map<PrimitiveId, Primitive>();
  for (const p of primitives) {
    map.set(p.id as PrimitiveId, p);
  }
  const scene: Scene = {
    primitives: map,
    theme,
  };
  const result = compile(scene);
  const envelope = serializeAsExcalidrawFile(result);
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

async function runRegisterCli(target: 'claude' | 'codex'): Promise<void> {
  if (target === 'claude') {
    await registerClaude();
    process.stderr.write('[drawcast-mcp] registered with Claude Code\n');
    return;
  }
  await registerCodex();
  process.stderr.write('[drawcast-mcp] registered with Codex\n');
}

async function registerClaude(): Promise<void> {
  const configPath = path.join(os.homedir(), '.claude.json');
  let config: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === 'object') {
      config = parsed as Record<string, unknown>;
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      throw err;
    }
  }

  const mcpServers =
    typeof config.mcpServers === 'object' && config.mcpServers !== null
      ? (config.mcpServers as Record<string, unknown>)
      : {};
  mcpServers.drawcast = {
    command: 'drawcast-mcp',
    args: ['--stdio'],
  };
  config.mcpServers = mcpServers;

  await writeAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

async function registerCodex(): Promise<void> {
  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  let existing = '';
  try {
    existing = await fs.readFile(configPath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      throw err;
    }
  }

  let parsed: Record<string, unknown> = {};
  if (existing.length > 0) {
    try {
      parsed = parseTOML(existing) as Record<string, unknown>;
    } catch {
      // Fall back to appending a [mcp_servers.drawcast] block so we don't
      // blow away a config we couldn't parse.
      const appended = `${existing.replace(/\s*$/, '')}\n\n[mcp_servers.drawcast]\ncommand = "drawcast-mcp"\nargs = ["--stdio"]\n`;
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await writeAtomic(configPath, appended);
      return;
    }
  }

  const mcp =
    typeof parsed.mcp_servers === 'object' && parsed.mcp_servers !== null
      ? (parsed.mcp_servers as Record<string, unknown>)
      : {};
  mcp.drawcast = {
    command: 'drawcast-mcp',
    args: ['--stdio'],
  };
  parsed.mcp_servers = mcp;

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await writeAtomic(configPath, `${stringifyTOML(parsed)}\n`);
}

async function writeAtomic(targetPath: string, contents: string): Promise<void> {
  const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, contents, 'utf8');
  try {
    await fs.rename(tmp, targetPath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const result = parseArgs(argv);
  if ('error' in result) {
    process.stderr.write(`${result.error}\n\n${USAGE}`);
    process.exit(2);
  }

  const mode = result.mode;
  switch (mode.kind) {
    case 'help':
      process.stdout.write(USAGE);
      return;
    case 'version':
      process.stdout.write(`${VERSION}\n`);
      return;
    case 'stdio':
      await runStdio();
      return;
    case 'sse':
      await runSse({ port: mode.port, sessionPath: mode.sessionPath });
      return;
    case 'compile':
      await runCompile(mode.file);
      return;
    case 'register-cli':
      await runRegisterCli(mode.target);
      return;
  }
}

main(process.argv).catch((err) => {
  process.stderr.write(
    `[drawcast-mcp] fatal: ${
      err instanceof Error ? err.stack ?? err.message : String(err)
    }\n`,
  );
  process.exit(1);
});
