// Emitter for the Embed primitive. See docs/02-l2-primitives.md §378-400
// and docs/03-compile-pipeline.md §292-310.
//
// The Excalidraw on-disk format represents iframe/embeddable as `type: 'iframe'`
// (see docs/08 and types/excalidraw.ts). We emit `link` so the URL survives
// even if the caller's host downgrades `validated`.

import type { Embed, Radians } from '../primitives.js';
import { degreesToRadians } from '../utils/angle.js';
import { baseElementFields } from '../utils/baseElementFields.js';
import { newElementId } from '../utils/id.js';
import type { ExcalidrawIframeElement } from '../types/excalidraw.js';
import type { CompileContext } from '../compile/context.js';

export function emitEmbed(p: Embed, ctx: CompileContext): void {
  const [w, h] = p.size;
  const x = p.at[0] - w / 2;
  const y = p.at[1] - h / 2;

  if (!p.validated) {
    ctx.pushWarning({
      code: 'EMBED_NOT_VALIDATED',
      message: `Embed ${p.id} URL not explicitly validated; Excalidraw may refuse to load.`,
      primitiveId: p.id,
    });
  }

  const id = newElementId();
  const base = baseElementFields({
    id,
    x,
    y,
    width: w,
    height: h,
    angle: degreesToRadians(p.angle ?? 0),
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: p.opacity ?? 100,
    roundness: null,
    locked: p.locked ?? false,
    // The URL travels on `link` so legacy loaders still see it.
    link: p.url,
    customData: { ...(p.customData ?? {}), drawcastPrimitiveId: p.id },
  });

  const element: ExcalidrawIframeElement = {
    ...base,
    type: 'iframe',
    angle: base.angle as Radians,
    ...(p.validated !== undefined ? { validated: p.validated } : {}),
  };

  ctx.emit(element);
  ctx.registerPrimitive(p.id, {
    kind: 'embed',
    elementIds: [id],
    primaryId: id,
    bbox: { x, y, w, h },
  });
}
