// Shared error-message helpers for tool handlers.
//
// `SceneLockError` is raised by `SceneStore.upsert` whenever a caller tries to
// mutate a primitive the user has edit-locked from the canvas. The user-facing
// "Reset edits" button clears every lock at once, so we surface that specific
// affordance in the tool's error text — CLIs can relay the exact wording to
// the user.
//
// Keep this module free of imports from store/types so the helper can be
// reused from every `draw_upsert_*` handler without dragging in cycles.

import type { PrimitiveId } from '@drawcast/core';

/**
 * Human-readable message for a locked-primitive upsert attempt. The wording
 * is load-bearing — tests assert that it mentions "Reset edits" so the CLI
 * surface can point users at the correct affordance.
 */
export function lockErrorMessage(id: PrimitiveId | string): string {
  return `Primitive ${id} is locked by user edits. Use draw_upsert again after the user clicks "Reset edits", or work on a different primitive.`;
}
