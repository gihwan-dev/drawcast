// Emitter for the Freedraw primitive: a pass-through stroke element.
// See docs/02-l2-primitives.md §313-336 and docs/03-compile-pipeline.md §292-310.
//
// Pitfall guards:
//   P3  — points[0] is treated as local [0,0]; we normalise defensively so a
//         caller supplying non-origin offsets still ends up at [0,0].
//   C1  — simulatePressure defaults to true ONLY when pressures is absent.
//   C2  — pressures length mismatch is tolerated: we pad/truncate to match
//         points (emitting a warning) rather than throwing.

import type { Freedraw, Radians } from '../primitives.js';
import { degreesToRadians } from '../utils/angle.js';
import { baseElementFields } from '../utils/baseElementFields.js';
import { newElementId } from '../utils/id.js';
import type { ExcalidrawFreedrawElement } from '../types/excalidraw.js';
import type { CompileContext } from '../compile/context.js';
import { resolveNodeStyle } from '../compile/resolveStyle.js';
import { normalizePoints } from './shared/points.js';

export function emitFreedraw(p: Freedraw, ctx: CompileContext): void {
  // Use node-style semantics for stroke colour/width; freedraw has no fill.
  const style = resolveNodeStyle(p.style, ctx.theme, p.id, ctx);

  // Freedraw points are already LOCAL — normalise defensively so a caller
  // who started off-origin still gets points[0] === [0, 0].
  const normalized = normalizePoints(p.points);

  // pressures/points length reconciliation.
  let pressures: number[] = [];
  if (p.pressures !== undefined) {
    pressures = [...p.pressures];
    if (pressures.length !== normalized.points.length) {
      ctx.pushWarning({
        code: 'FREEDRAW_PRESSURE_MISMATCH',
        message: `Freedraw ${p.id} has ${pressures.length} pressure(s) for ${normalized.points.length} point(s); padding/truncating.`,
        primitiveId: p.id,
      });
      if (pressures.length < normalized.points.length) {
        const pad = normalized.points.length - pressures.length;
        for (let i = 0; i < pad; i++) pressures.push(0.5);
      } else {
        pressures = pressures.slice(0, normalized.points.length);
      }
    }
  }
  const simulatePressure = p.simulatePressure ?? p.pressures === undefined;

  const id = newElementId();
  const base = baseElementFields({
    id,
    x: p.at[0],
    y: p.at[1],
    width: normalized.width,
    height: normalized.height,
    angle: degreesToRadians(p.angle ?? 0),
    strokeColor: style.strokeColor,
    // freedraw renders outlines only — keep fill transparent.
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: style.strokeWidth,
    strokeStyle: style.strokeStyle,
    roughness: style.roughness,
    opacity: p.opacity ?? 100,
    roundness: null,
    locked: p.locked ?? false,
    link: p.link ?? null,
    ...(p.customData !== undefined ? { customData: p.customData } : {}),
  });

  const element: ExcalidrawFreedrawElement = {
    ...base,
    type: 'freedraw',
    angle: base.angle as Radians,
    points: normalized.points,
    pressures,
    simulatePressure,
    lastCommittedPoint: null,
  };

  ctx.emit(element);
  ctx.registerPrimitive(p.id, {
    kind: 'freedraw',
    elementIds: [id],
    primaryId: id,
    bbox: {
      x: p.at[0],
      y: p.at[1],
      w: normalized.width,
      h: normalized.height,
    },
  });
}
