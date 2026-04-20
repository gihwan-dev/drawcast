import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';

export interface McpCommand {
  command: string;
  args: string[];
  entryPath: string;
}

export interface DrawcastMcpProcess {
  child: unknown;
  terminate: () => Promise<void>;
}

export function resolveDrawcastMcpCommand(repoRoot: string): McpCommand {
  const entryPath = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
  return {
    command: process.execPath,
    args: [entryPath, '--stdio'],
    entryPath,
  };
}

export async function assertDrawcastMcpBuilt(
  command: McpCommand,
): Promise<void> {
  await fs.access(command.entryPath);
}

export async function writeMcpConfig(options: {
  repoRoot: string;
  runDir: string;
  questionId: string;
  sample: number;
}): Promise<string> {
  const command = resolveDrawcastMcpCommand(options.repoRoot);
  await assertDrawcastMcpBuilt(command);

  const configDir = path.join(options.runDir, '.mcp');
  await fs.mkdir(configDir, { recursive: true });
  const configPath = path.join(
    configDir,
    `${options.questionId}-${options.sample}.json`,
  );
  const config = {
    mcpServers: {
      drawcast: {
        command: command.command,
        args: command.args,
      },
    },
  };
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return configPath;
}

export async function spawnDrawcastMcp(
  repoRoot: string,
): Promise<DrawcastMcpProcess> {
  const command = resolveDrawcastMcpCommand(repoRoot);
  await assertDrawcastMcpBuilt(command);
  const child = execa(command.command, command.args, {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    reject: false,
  });

  return {
    child,
    terminate: async () => {
      const forceKillTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 1500);
      try {
        child.kill('SIGTERM');
        await child;
      } catch {
        // The process may already be gone after SIGTERM.
      } finally {
        clearTimeout(forceKillTimer);
      }
    },
  };
}
