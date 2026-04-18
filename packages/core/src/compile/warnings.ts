// Non-fatal compile diagnostics. Emitters push warnings through the
// context; `finalize()` returns them alongside the element list so the
// caller can surface them without the compile throwing.
// See docs/03-compile-pipeline.md (§ "에러 처리").

import type { PrimitiveId } from '../primitives.js';

export interface CompileWarning {
  /** Stable machine-readable code (e.g. `STYLE_PRESET_MISSING`). */
  code: string;
  /** Human-readable detail for logs or devtools. */
  message: string;
  /** Primitive that triggered the warning, if any. */
  primitiveId?: PrimitiveId;
}

/** Fatal counterpart — thrown, never accumulated. Reserved for future use. */
export interface CompileError extends CompileWarning {
  fatal: true;
}
