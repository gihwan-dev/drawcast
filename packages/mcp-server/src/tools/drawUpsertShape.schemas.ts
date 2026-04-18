// Per-kind zod schemas for `draw_upsert_shape`. Split out of the main tool
// file so that module stays under the 180-line soft cap while still
// documenting each coverage primitive's shape explicitly.

import { z } from 'zod';
import { PointSchema, SizeSchema, StyleRefSchema } from './utils.js';

export const lineInputSchema = z.object({
  kind: z.literal('line'),
  id: z.string().min(1),
  at: PointSchema,
  points: z.array(PointSchema).min(2),
  dashed: z.boolean().optional(),
  rounded: z.boolean().optional(),
  polygon: z.boolean().optional(),
  style: StyleRefSchema.optional(),
  angle: z.number().optional(),
  locked: z.boolean().optional(),
  opacity: z.number().min(0).max(100).optional(),
});

export const freedrawInputSchema = z.object({
  kind: z.literal('freedraw'),
  id: z.string().min(1),
  at: PointSchema,
  points: z.array(PointSchema).min(1),
  pressures: z.array(z.number()).optional(),
  simulatePressure: z.boolean().optional(),
  style: StyleRefSchema.optional(),
  angle: z.number().optional(),
  locked: z.boolean().optional(),
  opacity: z.number().min(0).max(100).optional(),
});

export const imageSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('path'), path: z.string().min(1) }),
  z.object({
    kind: z.literal('data'),
    dataURL: z.string().min(1),
    mimeType: z.string().min(1),
  }),
]);

export const imageInputSchema = z.object({
  kind: z.literal('image'),
  id: z.string().min(1),
  at: PointSchema,
  size: SizeSchema,
  source: imageSourceSchema,
  crop: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
      naturalWidth: z.number().positive(),
      naturalHeight: z.number().positive(),
    })
    .optional(),
  scale: z.tuple([z.number(), z.number()]).optional(),
  angle: z.number().optional(),
  locked: z.boolean().optional(),
  opacity: z.number().min(0).max(100).optional(),
});

export const embedInputSchema = z.object({
  kind: z.literal('embed'),
  id: z.string().min(1),
  at: PointSchema,
  size: SizeSchema,
  url: z.string().min(1),
  validated: z.boolean().optional(),
  angle: z.number().optional(),
  locked: z.boolean().optional(),
  opacity: z.number().min(0).max(100).optional(),
});

export type LineInput = z.infer<typeof lineInputSchema>;
export type FreedrawInput = z.infer<typeof freedrawInputSchema>;
export type ImageInput = z.infer<typeof imageInputSchema>;
export type EmbedInput = z.infer<typeof embedInputSchema>;
