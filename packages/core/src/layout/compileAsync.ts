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

/** Resolve the layout flag with a Node-default-on, browser-default-off
 *  posture. Accessed through `globalThis` so this module stays
 *  compilable without `@types/node` — the Tauri WebView imports this
 *  package too and must not force a Node-typed global surface.
 *
 *  - No `process` (e.g. Tauri WebView): always false. The UI layer
 *    still renders via the sync `compile` path and never pulls in
 *    the ELK binding.
 *  - Node with no env var set: true. MCP server and evals opt in
 *    by default now that Commit #7 flipped the gate.
 *  - Node with `DRAWCAST_LAYOUT_ENGINE=off|0|false`: false. Explicit
 *    escape hatch for debugging or rollback without a code change. */
function isLayoutEnabledFromEnv(): boolean {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (proc?.env === undefined) {
    return false;
  }
  const value = proc.env.DRAWCAST_LAYOUT_ENGINE;
  if (value === 'off' || value === '0' || value === 'false') {
    return false;
  }
  return true;
}
