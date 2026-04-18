// Public compile entry point. Constructs a CompileContext and runs the
// three passes in order. See docs/03-compile-pipeline.md.

import type { Scene } from '../primitives.js';
import { CompileContext } from './context.js';
import { passGrouping, passPositional, passRelational } from './passes.js';

export { CompileContext } from './context.js';
export type { CompileResult, PrimitiveRecord } from './context.js';
export type { CompileWarning, CompileError } from './warnings.js';
export {
  resolveNodeStyle,
  resolveEdgeStyle,
  applyGlobal,
  type ResolvedNodeStyle,
  type ResolvedEdgeStyle,
} from './resolveStyle.js';

/**
 * Compile an L2 Scene into L1 Excalidraw elements, files, and warnings.
 * Pure function — never throws for non-fatal input (pushes warnings instead).
 */
export function compile(scene: Scene) {
  const ctx = new CompileContext(scene.theme);
  passPositional(scene, ctx);
  passRelational(scene, ctx);
  passGrouping(scene, ctx);
  return ctx.finalize();
}
