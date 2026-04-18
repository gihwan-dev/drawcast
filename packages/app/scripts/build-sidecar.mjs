#!/usr/bin/env node
// Build the @drawcast/mcp-server sidecar as a standalone binary via
// `bun build --compile` and drop it under
// `packages/app/src-tauri/binaries/drawcast-mcp-<triple><ext>`.
//
// Default: build for the CURRENT host platform.
// `--target <triple>` (PR #21): build for an explicit Tauri triple so CI can
// cross-compile each matrix leg without relying on the runner's auto-detect.
//
// Usage:
//   node scripts/build-sidecar.mjs
//   node scripts/build-sidecar.mjs --target aarch64-apple-darwin

import { spawn } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(APP_DIR, '..', '..');
const ENTRY = path.join(REPO_ROOT, 'packages', 'mcp-server', 'src', 'cli.ts');
const OUT_DIR = path.join(APP_DIR, 'src-tauri', 'binaries');

// Map Node's process.platform/arch → { tauri triple, bun target, exe ext }.
// Keep this table in sync with docs/01-architecture.md §Sidecar bundling.
const TARGETS = {
  'darwin:arm64': {
    triple: 'aarch64-apple-darwin',
    bunTarget: 'bun-darwin-arm64',
    ext: '',
  },
  'darwin:x64': {
    triple: 'x86_64-apple-darwin',
    bunTarget: 'bun-darwin-x64',
    ext: '',
  },
  'linux:x64': {
    triple: 'x86_64-unknown-linux-gnu',
    bunTarget: 'bun-linux-x64',
    ext: '',
  },
  'win32:x64': {
    triple: 'x86_64-pc-windows-msvc',
    bunTarget: 'bun-windows-x64',
    ext: '.exe',
  },
};

// Reverse index from Tauri triple → target record, so `--target` can request
// a specific triple without the caller having to know the bun-target name.
const BY_TRIPLE = Object.fromEntries(
  Object.values(TARGETS).map((t) => [t.triple, t]),
);

function die(msg, code = 1) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { target: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') {
      out.target = argv[i + 1];
      i += 1;
    } else if (arg?.startsWith('--target=')) {
      out.target = arg.slice('--target='.length);
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'Usage: build-sidecar.mjs [--target <triple>]\n' +
          `Supported triples: ${Object.keys(BY_TRIPLE).join(', ')}\n`,
      );
      process.exit(0);
    }
  }
  return out;
}

async function hasBun() {
  return new Promise((resolve) => {
    const child = spawn('bun', ['--version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (exitCode) => resolve(exitCode === 0));
  });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

function resolveTarget(explicit) {
  if (explicit) {
    const hit = BY_TRIPLE[explicit];
    if (!hit) {
      die(
        `Unknown target triple: ${explicit}. ` +
          `Supported: ${Object.keys(BY_TRIPLE).join(', ')}`,
      );
    }
    return hit;
  }
  const key = `${process.platform}:${process.arch}`;
  const hit = TARGETS[key];
  if (!hit) {
    die(
      `Unsupported platform: ${key}. Supported: ${Object.keys(TARGETS).join(', ')}`,
    );
  }
  return hit;
}

async function main() {
  const { target: explicit } = parseArgs(process.argv.slice(2));
  const target = resolveTarget(explicit);

  if (!(await hasBun())) {
    die(
      "bun not found — install with 'curl -fsSL https://bun.sh/install | bash' then re-run 'pnpm build:sidecar'",
    );
  }

  try {
    await access(ENTRY, constants.R_OK);
  } catch {
    die(`mcp-server entry not found: ${ENTRY}`);
  }

  await mkdir(OUT_DIR, { recursive: true });

  const outFile = path.join(
    OUT_DIR,
    `drawcast-mcp-${target.triple}${target.ext}`,
  );

  process.stdout.write(
    `[build-sidecar] building ${target.triple} → ${path.relative(REPO_ROOT, outFile)}\n`,
  );

  try {
    await run(
      'bun',
      [
        'build',
        ENTRY,
        '--compile',
        `--target=${target.bunTarget}`,
        `--outfile=${outFile}`,
      ],
      { cwd: REPO_ROOT },
    );
  } catch (err) {
    die(`bun build failed: ${err.message}`);
  }

  process.stdout.write('[build-sidecar] done\n');
}

main().catch((err) => {
  die(`[build-sidecar] ${err.message ?? err}`);
});
