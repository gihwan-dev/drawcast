#!/usr/bin/env node
// CLI entry for `drawcast-mcp`.
//
// For this PR only the default stdio mode is supported. SSE mode, the
// `compile` subcommand, and `config register-cli` subcommand land in PR #11.

import { connectStdio, createServer, VERSION } from './index.js';

const USAGE = `Usage: drawcast-mcp [--stdio]

Options:
  --stdio        Run as stdio MCP server (default)
  --help, -h     Show this help
  --version, -v  Print version
`;

async function main(argv: readonly string[]): Promise<void> {
  const args = argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE);
    return;
  }
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  // Default (and the only mode in this PR) is stdio. The `--stdio` flag is
  // accepted explicitly so invocations in MCP client config remain valid
  // once SSE mode is added.
  const unknown = args.filter((a) => a !== '--stdio');
  if (unknown.length > 0) {
    process.stderr.write(`Unknown arguments: ${unknown.join(' ')}\n\n${USAGE}`);
    process.exit(2);
  }

  const drawcast = createServer();
  await connectStdio(drawcast);
}

main(process.argv).catch((err) => {
  process.stderr.write(
    `[drawcast-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
