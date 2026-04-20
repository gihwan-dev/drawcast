// Drawcast MCP server lifecycle for the eval runner.
//
// We run the server in SSE mode so two clients can share one SceneStore:
//   1. `claude -p` attached via --mcp-config (type=sse, url=http://.../sse)
//   2. the runner itself, which connects after Claude exits and calls
//      draw_export directly — removing the dependency on Claude voluntarily
//      invoking draw_export at the end of its session.

import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface DrawcastMcpHandle {
  port: number;
  url: string;
  sseUrl: string;
  sessionPath: string;
  child: ChildProcess;
  shutdown(): Promise<void>;
}

export function resolveDrawcastMcpEntry(repoRoot: string): string {
  return path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
}

export async function assertDrawcastMcpBuilt(entryPath: string): Promise<void> {
  await fs.access(entryPath);
}

export async function startDrawcastMcpSse(options: {
  repoRoot: string;
  runDir: string;
  questionId: string;
  sample: number;
  readyTimeoutMs?: number;
}): Promise<DrawcastMcpHandle> {
  const entryPath = resolveDrawcastMcpEntry(options.repoRoot);
  await assertDrawcastMcpBuilt(entryPath);

  const sessionPath = path.join(
    options.runDir,
    '.mcp-sessions',
    `${options.questionId}-${options.sample}`,
  );
  await fs.mkdir(sessionPath, { recursive: true });

  const child = spawn(
    process.execPath,
    [entryPath, '--sse', '--port', 'auto', '--session-path', sessionPath],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    },
  );

  const readyTimeoutMs = options.readyTimeoutMs ?? 10_000;

  return new Promise<DrawcastMcpHandle>((resolve, reject) => {
    let port: number | undefined;
    let ready = false;
    let stdoutBuf = '';
    const stderrChunks: string[] = [];

    const settleReject = (err: Error): void => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already dead */
      }
      reject(err);
    };

    const timer = setTimeout(() => {
      settleReject(
        new Error(
          `drawcast-mcp did not report READY within ${readyTimeoutMs}ms (stderr: ${stderrChunks
            .join('')
            .slice(-500)})`,
        ),
      );
    }, readyTimeoutMs);
    timer.unref?.();

    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', (code, signal) => {
      if (!ready) {
        clearTimeout(timer);
        reject(
          new Error(
            `drawcast-mcp exited before READY (code=${code ?? 'null'} signal=${
              signal ?? 'null'
            }; stderr: ${stderrChunks.join('').slice(-500)})`,
          ),
        );
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString('utf8'));
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      let nl = stdoutBuf.indexOf('\n');
      while (nl >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        nl = stdoutBuf.indexOf('\n');
        if (line.startsWith('DRAWCAST_PORT=')) {
          const n = Number.parseInt(line.slice('DRAWCAST_PORT='.length), 10);
          if (Number.isFinite(n) && n > 0) port = n;
          continue;
        }
        if (line === 'DRAWCAST_READY=1') {
          if (port === undefined) {
            clearTimeout(timer);
            settleReject(
              new Error('drawcast-mcp emitted READY before PORT'),
            );
            return;
          }
          ready = true;
          clearTimeout(timer);
          const url = `http://127.0.0.1:${port}`;
          resolve({
            port,
            url,
            sseUrl: `${url}/sse`,
            sessionPath,
            child,
            shutdown: () => shutdownChild(child),
          });
          return;
        }
      }
    });
  });
}

async function shutdownChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  const forceKill = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }, 1500);
  forceKill.unref?.();
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    try {
      child.kill('SIGTERM');
    } catch {
      resolve();
    }
  });
  clearTimeout(forceKill);
}

export async function writeMcpSseConfig(options: {
  runDir: string;
  questionId: string;
  sample: number;
  sseUrl: string;
}): Promise<string> {
  const configDir = path.join(options.runDir, '.mcp');
  await fs.mkdir(configDir, { recursive: true });
  const configPath = path.join(
    configDir,
    `${options.questionId}-${options.sample}.json`,
  );
  const config = {
    mcpServers: {
      drawcast: {
        type: 'sse',
        url: options.sseUrl,
      },
    },
  };
  await fs.writeFile(
    configPath,
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  );
  return configPath;
}
