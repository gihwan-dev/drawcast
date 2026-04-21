// Render a fixed flowchart twice — with and without the Phase 2 layout
// engine — and dump the two PNGs side by side. Useful as a manual "did
// this actually improve things?" check that does not require running
// the full Codex-rubric eval harness.
//
// Usage:
//   pnpm -C evals build
//   node evals/dist/runner/scripts/layout-smoke.js [outDir]
//
// Default outDir is /tmp/layout-smoke.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  compileAsync,
  serializeAsExcalidrawFile,
  sketchyTheme,
  type Connector,
  type LabelBox,
  type Primitive,
  type PrimitiveId,
  type Scene,
} from '@drawcast/core';
import { renderSceneToPng } from '../render.js';
import type { ExcalidrawScene } from '../types.js';

function box(
  id: string,
  text: string,
  shape: LabelBox['shape'] = 'rectangle',
): LabelBox {
  return {
    kind: 'labelBox',
    id: id as PrimitiveId,
    shape,
    text,
    // No `at` — Phase 2 hybrid contract. ELK places the node; the
    // sync-compile fallback plants it at the origin for comparison.
  };
}

function edge(id: string, from: string, to: string, label?: string): Connector {
  return {
    kind: 'connector',
    id: id as PrimitiveId,
    from: from as PrimitiveId,
    to: to as PrimitiveId,
    routing: 'elbow',
    ...(label !== undefined && { label }),
  };
}

function buildLoginFlowchart(): Scene {
  // Reconstruction of the user flowchart from the original PR conversation:
  // Start -> email/password -> validate? -> (invalid) warning -> retry -> email
  //                                   \-> (valid) auth -> auth_ok?
  //                                          \-> (fail) error -> retry -> email
  //                                          \-> (pass) success -> dashboard -> end
  const primitives: Primitive[] = [
    box('start', '시작', 'ellipse'),
    box('email', '이메일 / 비밀번호 입력'),
    box('validate', '입력값 검증', 'diamond'),
    box('warning', '입력 오류 안내'),
    box('auth', '서버 인증 요청'),
    box('auth_ok', '인증 성공?', 'diamond'),
    box('error', '오류 메시지 표시'),
    box('success', '로그인 성공'),
    box('dashboard', '대시보드 이동'),
    box('end', '종료', 'ellipse'),
    edge('e1', 'start', 'email'),
    edge('e2', 'email', 'validate'),
    edge('e3', 'validate', 'warning', '무효'),
    edge('e4', 'warning', 'email', '재입력'),
    edge('e5', 'validate', 'auth', '유효'),
    edge('e6', 'auth', 'auth_ok'),
    edge('e7', 'auth_ok', 'error', '실패'),
    edge('e8', 'error', 'email', '재시도'),
    edge('e9', 'auth_ok', 'success', '성공'),
    edge('e10', 'success', 'dashboard'),
    edge('e11', 'dashboard', 'end'),
  ];
  return {
    primitives: new Map(primitives.map((p) => [p.id, p])),
    theme: sketchyTheme,
  };
}

async function renderTo(
  scene: Scene,
  outPath: string,
  useLayout: boolean,
): Promise<void> {
  const compiled = await compileAsync(scene, { useLayout });
  const envelope = serializeAsExcalidrawFile(compiled);
  // `serializeAsExcalidrawFile` returns an Excalidraw-compatible envelope
  // whose element array matches the ExcalidrawScene the render module
  // accepts; cast rather than re-shape so we do not lose metadata.
  await renderSceneToPng(envelope as unknown as ExcalidrawScene, outPath);
}

async function main(): Promise<void> {
  const outDir = process.argv[2] ?? '/tmp/layout-smoke';
  await fs.mkdir(outDir, { recursive: true });

  const scene = buildLoginFlowchart();
  const beforePath = path.join(outDir, 'before.png');
  const afterPath = path.join(outDir, 'after.png');

  process.stdout.write(`[1/2] rendering BEFORE (useLayout=false) ... `);
  await renderTo(scene, beforePath, false);
  process.stdout.write('done\n');

  process.stdout.write(`[2/2] rendering AFTER  (useLayout=true)  ... `);
  await renderTo(scene, afterPath, true);
  process.stdout.write('done\n');

  process.stdout.write(`\nWrote:\n  ${beforePath}\n  ${afterPath}\n`);
}

await main();
