// Phase 2: Node/MCP context only.
// Async entry point that runs the layout pipeline ahead of the existing
// synchronous compile. `compile()` stays as the canonical sync path —
// this wraps it so the Tauri WebView can keep consuming pre-laid scenes
// without pulling in elkjs. See docs/11-layout-engine.md §9.5.

import { compile } from '../compile/index.js';
import type { CompileResult } from '../compile/context.js';
import type { Scene } from '../primitives.js';
import { applyLayoutToScene } from './applyLayoutToScene.js';
import { buildGraphModel } from './buildGraphModel.js';
import { ElkLayoutEngine } from './elkEngine.js';
import type { LayoutEngine } from './engine.js';

export interface CompileAsyncOptions {
  /** Force the layout pass on or off. When undefined the runtime reads
   *  `DRAWCAST_LAYOUT_ENGINE` from `process.env`. */
  useLayout?: boolean;
  /** Inject a custom engine (mostly for tests and per-diagram presets). */
  engine?: LayoutEngine;
}

export async function compileAsync(
  scene: Scene,
  options: CompileAsyncOptions = {},
): Promise<CompileResult> {
  const useLayout = options.useLayout ?? isLayoutEnabledFromEnv();
  if (!useLayout) {
    return compile(scene);
  }

  const graph = buildGraphModel(scene);
  // Scene either fell outside layout scope (frame present) or had no
  // layout-eligible primitives; preserve the legacy behaviour.
  if (graph === null || graph.children.length === 0) {
    return compile(scene);
  }

  const engine = options.engine ?? new ElkLayoutEngine();
  const laid = await engine.layout(graph);
  const enrichedScene = applyLayoutToScene(scene, laid);
  return compile(enrichedScene);
}

/** True when the env var is explicitly opted-in. Accessed through
 *  `globalThis` so this module stays compilable without `@types/node`
 *  — the Tauri WebView imports this package as well and must not
 *  force a Node-typed global surface. Browser contexts have no
 *  `process` and therefore default the flag off, which is exactly
 *  the Phase 2 posture. */
function isLayoutEnabledFromEnv(): boolean {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (proc?.env === undefined) {
    return false;
  }
  const value = proc.env.DRAWCAST_LAYOUT_ENGINE;
  return value === 'on' || value === '1' || value === 'true';
}
