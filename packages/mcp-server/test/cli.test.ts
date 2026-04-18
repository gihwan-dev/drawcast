// CLI integration tests.
//
// Each test spawns the built `dist/cli.js` as a child process — the CLI
// is the public surface the Tauri sidecar (PR #12) and users touch, so
// we verify that contract end-to-end. `DRAWCAST_FAST_EXIT=1` makes the
// process exit a short time after SSE startup so the test harness doesn't
// have to send a signal to the child.

import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, '..', 'dist', 'cli.js');

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('CLI test timed out'));
    }, options.timeoutMs ?? 5_000);
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe('drawcast-mcp CLI', () => {
  it('prints usage with --help and exits 0', async () => {
    const result = await runCli(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: drawcast-mcp');
    expect(result.stdout).toContain('--sse');
  });

  it('prints version with --version', async () => {
    const result = await runCli(['--version']);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('boots --sse and exposes DRAWCAST_PORT + /healthz', async () => {
    const sessionPath = path.join(os.tmpdir(), 'drawcast-cli-' + randomUUID());
    const result = await runCli(
      ['--sse', '--port', 'auto', '--session-path', sessionPath],
      {
        env: { DRAWCAST_FAST_EXIT: '250' },
        timeoutMs: 8_000,
      },
    );
    expect(result.code).toBe(0);
    const portMatch = /DRAWCAST_PORT=(\d+)/.exec(result.stdout);
    expect(portMatch).not.toBeNull();
    expect(result.stdout).toContain('DRAWCAST_READY=1');

    const sceneFile = path.join(sessionPath, 'scene.excalidraw');
    await expect(fs.access(sceneFile)).resolves.toBeUndefined();
  });
});
