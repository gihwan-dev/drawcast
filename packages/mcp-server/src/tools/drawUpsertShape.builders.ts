// Per-kind primitive builders for `draw_upsert_shape`. Extracted from the
// main tool file to keep that module under the 180-line soft cap.
//
// exactOptionalPropertyTypes means we spread defined-only properties for
// each optional field so the built primitive is free of spurious
// `undefined` values — hence the repetitive but explicit structure.

import type {
  Embed,
  Freedraw,
  Image,
  Line,
  Point,
  PrimitiveId,
} from '@drawcast/core';
import { normalizeStyleRef } from './utils.js';
import type {
  EmbedInput,
  FreedrawInput,
  ImageInput,
  LineInput,
} from './drawUpsertShape.schemas.js';

export function buildLine(args: LineInput): Line {
  const points = args.points.map(([x, y]) => [x, y] as Point);
  return {
    kind: 'line',
    id: args.id as PrimitiveId,
    at: [args.at[0], args.at[1]],
    points,
    ...(args.dashed !== undefined && { dashed: args.dashed }),
    ...(args.rounded !== undefined && { rounded: args.rounded }),
    ...(args.polygon !== undefined && { polygon: args.polygon }),
    ...(args.style !== undefined && { style: normalizeStyleRef(args.style) }),
    ...(args.angle !== undefined && { angle: args.angle }),
    ...(args.locked !== undefined && { locked: args.locked }),
    ...(args.opacity !== undefined && { opacity: args.opacity }),
  };
}

export function buildFreedraw(args: FreedrawInput): Freedraw {
  const points = args.points.map(([x, y]) => [x, y] as Point);
  return {
    kind: 'freedraw',
    id: args.id as PrimitiveId,
    at: [args.at[0], args.at[1]],
    points,
    ...(args.pressures !== undefined && { pressures: [...args.pressures] }),
    ...(args.simulatePressure !== undefined && {
      simulatePressure: args.simulatePressure,
    }),
    ...(args.style !== undefined && { style: normalizeStyleRef(args.style) }),
    ...(args.angle !== undefined && { angle: args.angle }),
    ...(args.locked !== undefined && { locked: args.locked }),
    ...(args.opacity !== undefined && { opacity: args.opacity }),
  };
}

export function buildImage(args: ImageInput): Image {
  const source: Image['source'] =
    args.source.kind === 'path'
      ? { kind: 'path', path: args.source.path }
      : {
          kind: 'data',
          dataURL: args.source.dataURL,
          mimeType: args.source.mimeType,
        };
  return {
    kind: 'image',
    id: args.id as PrimitiveId,
    at: [args.at[0], args.at[1]],
    size: [args.size[0], args.size[1]] as const,
    source,
    ...(args.crop !== undefined && { crop: { ...args.crop } }),
    ...(args.scale !== undefined && {
      scale: [args.scale[0], args.scale[1]] as const,
    }),
    ...(args.angle !== undefined && { angle: args.angle }),
    ...(args.locked !== undefined && { locked: args.locked }),
    ...(args.opacity !== undefined && { opacity: args.opacity }),
  };
}

export function buildEmbed(args: EmbedInput): Embed {
  return {
    kind: 'embed',
    id: args.id as PrimitiveId,
    at: [args.at[0], args.at[1]],
    size: [args.size[0], args.size[1]] as const,
    url: args.url,
    ...(args.validated !== undefined && { validated: args.validated }),
    ...(args.angle !== undefined && { angle: args.angle }),
    ...(args.locked !== undefined && { locked: args.locked }),
    ...(args.opacity !== undefined && { opacity: args.opacity }),
  };
}
