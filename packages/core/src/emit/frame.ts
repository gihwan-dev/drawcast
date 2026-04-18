// Emitter for the Frame primitive: emits a frame element in pass 1 and
// wires `frameId` onto each child's produced elements in pass 3.
// See docs/03 §602-633.
//
// Pitfall guards:
//   P8 — children must resolve to real frame ids, else warn and skip.

import type { Frame, Radians } from '../primitives.js';
import { degreesToRadians } from '../utils/angle.js';
import { baseElementFields } from '../utils/baseElementFields.js';
import { newElementId } from '../utils/id.js';
import type {
  ExcalidrawFrameElement,
  ExcalidrawMagicFrameElement,
} from '../types/excalidraw.js';
import type { CompileContext } from '../compile/context.js';

/**
 * Emit the frame element itself. Children-frame wiring happens in pass 3
 * (`applyFrameChildren`) because child primitives may be emitted later.
 */
export function emitFrame(p: Frame, ctx: CompileContext): void {
  const [w, h] = p.size;
  const id = newElementId();
  // Frame visual style is overridden by Excalidraw's FRAME_STYLE constant,
  // so we don't bother resolving the theme here — just emit sane defaults.
  const base = baseElementFields({
    id,
    x: p.at[0],
    y: p.at[1],
    width: w,
    height: h,
    angle: degreesToRadians(p.angle ?? 0),
    strokeColor: '#bbb',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: p.opacity ?? 100,
    roundness: null,
    locked: p.locked ?? false,
    link: p.link ?? null,
    customData: { ...(p.customData ?? {}), drawcastPrimitiveId: p.id },
  });

  if (p.magic === true) {
    const magic: ExcalidrawMagicFrameElement = {
      ...base,
      type: 'magicframe',
      angle: base.angle as Radians,
      name: p.title ?? null,
    };
    ctx.emit(magic);
  } else {
    const frame: ExcalidrawFrameElement = {
      ...base,
      type: 'frame',
      angle: base.angle as Radians,
      name: p.title ?? null,
    };
    ctx.emit(frame);
  }

  ctx.registerPrimitive(p.id, {
    kind: 'frame',
    elementIds: [id],
    primaryId: id,
    bbox: { x: p.at[0], y: p.at[1], w, h },
  });
}

/**
 * Pass-3 mutation: set `frameId` on every element produced by each child
 * primitive. Missing children are warned about but don't block compile.
 */
export function applyFrameChildren(p: Frame, ctx: CompileContext): void {
  const frameRecord = ctx.getRecord(p.id);
  if (!frameRecord) return;
  const frameElementId = frameRecord.primaryId;

  for (const childId of p.children) {
    const record = ctx.getRecord(childId);
    if (!record) {
      ctx.pushWarning({
        code: 'MISSING_CHILD',
        message: `Frame ${p.id} references unknown child primitive '${String(childId)}'.`,
        primitiveId: p.id,
      });
      continue;
    }
    for (const elementId of record.elementIds) {
      const el = ctx.getElementById(elementId);
      if (!el) continue;
      el.frameId = frameElementId;
    }
  }
}
