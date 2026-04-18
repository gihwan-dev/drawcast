// Emitter for the Group primitive: no new elements; it mutates existing
// elements' `groupIds` arrays. See docs/03 §573-600.
//
// Pitfall guards:
//   P7 — every child element of the group receives the same groupId.

import type { Group } from '../primitives.js';
import type { CompileContext } from '../compile/context.js';

export function applyGroup(p: Group, ctx: CompileContext): void {
  // The primitive's id doubles as the Excalidraw groupId — both are opaque
  // strings and we want Group membership to survive serialisation.
  const groupId = p.id;
  for (const childId of p.children) {
    const record = ctx.getRecord(childId);
    if (!record) {
      ctx.pushWarning({
        code: 'MISSING_CHILD',
        message: `Group ${p.id} references unknown child primitive '${String(childId)}'.`,
        primitiveId: p.id,
      });
      continue;
    }
    for (const elementId of record.elementIds) {
      const el = ctx.getElementById(elementId);
      if (!el) continue;
      // innermost -> outermost: nested groups append their outer id later.
      if (!el.groupIds.includes(groupId)) {
        el.groupIds = [...el.groupIds, groupId];
      }
    }
  }
}
