// Emitter for the Image primitive. See docs/02-l2-primitives.md §339-375
// and docs/03-compile-pipeline.md §292-310.
//
// Source handling:
//   - `kind: 'data'`: register the dataURL in `ctx.files` and mark element
//     `status: 'saved'`.
//   - `kind: 'path'`: synchronous compile cannot read the filesystem, so we
//     emit a placeholder element (`status: 'pending'`, `fileId: null`) and
//     push a `IMAGE_PATH_PENDING` warning. PR #11's `compileAsync` will
//     resolve these.
//
// Positioning: the element is centred on `p.at` — this mirrors LabelBox
// semantics so an image dropped at the same coordinates sits visually aligned.

import type { Image, Radians } from '../primitives.js';
import { degreesToRadians } from '../utils/angle.js';
import { baseElementFields } from '../utils/baseElementFields.js';
import { newElementId } from '../utils/id.js';
import type {
  ExcalidrawImageElement,
  FileId,
} from '../types/excalidraw.js';
import type { CompileContext } from '../compile/context.js';

export function emitImage(p: Image, ctx: CompileContext): void {
  const [w, h] = p.size;
  const x = p.at[0] - w / 2;
  const y = p.at[1] - h / 2;

  let fileId: FileId | null = null;
  let status: ExcalidrawImageElement['status'] = 'pending';

  if (p.source.kind === 'data') {
    // In PR #6 we key files by a fresh element id — PR #11 may switch this
    // to SHA-1(dataURL) for dedup. The Excalidraw format only requires the
    // string to match between element.fileId and files[fileId].id.
    const newId = newElementId() as FileId;
    fileId = newId;
    status = 'saved';
    const now = Date.now();
    ctx.files[newId] = {
      id: newId,
      mimeType: p.source.mimeType,
      dataURL: p.source.dataURL,
      created: now,
      lastRetrieved: now,
    };
  } else {
    // source.kind === 'path' — surface as a placeholder, let async resolve.
    ctx.pushWarning({
      code: 'IMAGE_PATH_PENDING',
      message: `Image ${p.id} uses path-based source '${p.source.path}'; requires compileAsync (PR #11). Emitting placeholder.`,
      primitiveId: p.id,
    });
  }

  const elementId = newElementId();
  const base = baseElementFields({
    id: elementId,
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
    roughness: 1,
    opacity: p.opacity ?? 100,
    roundness: null,
    locked: p.locked ?? false,
    link: p.link ?? null,
    ...(p.customData !== undefined ? { customData: p.customData } : {}),
  });

  const element: ExcalidrawImageElement = {
    ...base,
    type: 'image',
    angle: base.angle as Radians,
    fileId,
    status,
    scale: p.scale ?? [1, 1],
    crop: p.crop ?? null,
  };

  ctx.emit(element);
  ctx.registerPrimitive(p.id, {
    kind: 'image',
    elementIds: [elementId],
    primaryId: elementId,
    bbox: { x, y, w, h },
  });
}
