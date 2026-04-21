// Shared zod building blocks for MCP tool inputs.
//
// Kept minimal — only the parts that repeat across box / edge / sticky /
// future tools. Primitive-specific schemas live alongside each tool.

import { z } from 'zod';
import type { PreviewRequestOptions } from './helpers/preview.js';

/** `[x, y]` scene coordinates. */
export const PointSchema = z.tuple([z.number(), z.number()]);

/** `[width, height]` — both strictly positive. */
export const SizeSchema = z.tuple([
  z.number().positive(),
  z.number().positive(),
]);

/**
 * `StyleRef` — either a preset name (string) or an inline override object.
 * Matches the public `StyleRef` alias in `@drawcast/core`.
 */
export const StyleRefSchema = z.union([
  z.string(),
  z.object({
    preset: z.string().optional(),
    strokeColor: z.string().optional(),
    backgroundColor: z.string().optional(),
    fillStyle: z
      .enum(['hachure', 'cross-hatch', 'solid', 'zigzag'])
      .optional(),
    strokeWidth: z.number().positive().optional(),
    strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
    roughness: z
      .union([z.literal(0), z.literal(1), z.literal(2)])
      .optional(),
    fontFamily: z
      .union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(5),
        z.literal(6),
        z.literal(7),
        z.literal(8),
        z.literal(9),
      ])
      .optional(),
    fontSize: z.number().positive().optional(),
    roundness: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.null()])
      .optional(),
  }),
]);

/** Arrowhead kinds accepted by `draw_upsert_edge`. */
export const ArrowheadSchema = z.enum([
  'arrow',
  'triangle',
  'bar',
  'dot',
  'circle',
  'diamond',
]);

/**
 * Normalise a parsed `StyleRef` value so it conforms to the exact-optional
 * type the core `StyleOverride` uses. Zod's `.optional()` produces
 * `T | undefined` for each field which is incompatible with
 * `exactOptionalPropertyTypes: true`; this helper drops any `undefined`
 * entries so the resulting object shape only contains defined keys.
 */
export function normalizeStyleRef(
  style: z.infer<typeof StyleRefSchema>,
): import('@drawcast/core').StyleRef {
  if (typeof style === 'string') {
    return style;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as import('@drawcast/core').StyleRef;
}

/** `FontFamilyId` — must match `@drawcast/core`'s `FontFamilyId` union. */
export const FontFamilySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9),
]);

/**
 * Convert two-character backslash escapes (`\n`, `\r\n`, `\t`) that LLM
 * clients commonly emit verbatim inside JSON string arguments into real
 * control characters. Without this, a tool input like
 * `"text": "foo\\n(bar)"` renders the literal two-char sequence `\n` instead
 * of a line break.
 *
 * Why: Claude and other LLM clients occasionally over-escape multi-line
 * labels ("\\n" in the JSON source → two chars backslash+n after parse).
 * Diagram labels never legitimately contain a literal `\n` sequence, so
 * unescaping is safe.
 */
export function normalizeUserText(text: string): string {
  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

/**
 * Format a zod error for `isError` content. Keeps the message short and
 * targeted — we cannot dump the full pretty-printed tree through an MCP
 * text block because clients vary in how they render newlines.
 */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((issue) => {
      const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

/**
 * JSON Schema fragment for `StyleRef`. Each tool spreads this into its own
 * `properties` object under the `style` key — see `draw_upsert_box`
 * definition in docs/05-mcp-server.md.
 */
export const STYLE_REF_JSON_SCHEMA = {
  description: 'Style preset name or inline override',
  oneOf: [
    { type: 'string' },
    {
      type: 'object',
      properties: {
        preset: { type: 'string' },
        strokeColor: { type: 'string' },
        backgroundColor: { type: 'string' },
        fillStyle: {
          type: 'string',
          enum: ['hachure', 'cross-hatch', 'solid', 'zigzag'],
        },
        strokeWidth: { type: 'number' },
        strokeStyle: {
          type: 'string',
          enum: ['solid', 'dashed', 'dotted'],
        },
        roughness: { type: 'number', enum: [0, 1, 2] },
        fontFamily: { type: 'number', enum: [1, 2, 3, 5, 6, 7, 8, 9] },
        fontSize: { type: 'number' },
        roundness: { enum: [1, 2, 3, null] },
      },
    },
  ],
} as const;

/** JSON Schema fragment for a scene-coordinate `[x, y]` tuple. */
export const POINT_JSON_SCHEMA = {
  type: 'array',
  items: { type: 'number' },
  minItems: 2,
  maxItems: 2,
} as const;

/** JSON Schema fragment for a `[width, height]` tuple. */
export const SIZE_JSON_SCHEMA = {
  type: 'array',
  items: { type: 'number' },
  minItems: 2,
  maxItems: 2,
} as const;

/**
 * Optional `returnPreview` flag shared by every upsert tool. Accepts either
 * a bare boolean (`true` = take a snapshot with defaults) or an object that
 * tunes format/scale/timeout. Undefined / `false` disables preview.
 */
export const ReturnPreviewSchema = z
  .union([
    z.boolean(),
    z.object({
      format: z.enum(['png', 'jpeg']).optional(),
      scale: z.number().min(1).max(4).optional(),
      timeoutMs: z.number().min(1000).max(30_000).optional(),
    }),
  ])
  .optional();

/**
 * Normalise the parsed `returnPreview` value into preview helper options.
 * Returns `null` when the caller opted out (undefined or `false`).
 */
export function normalizeReturnPreview(
  value: z.infer<typeof ReturnPreviewSchema>,
): PreviewRequestOptions | null {
  if (value === undefined || value === false) {
    return null;
  }
  if (value === true) {
    return {};
  }
  const out: PreviewRequestOptions = {};
  if (value.format !== undefined) out.format = value.format;
  if (value.scale !== undefined) out.scale = value.scale;
  if (value.timeoutMs !== undefined) out.timeoutMs = value.timeoutMs;
  return out;
}

/**
 * JSON Schema fragment for `returnPreview`. Tools spread this into their
 * own `properties` object. The wording explicitly calls out the
 * self-feedback use case and the token cost so the model doesn't blindly
 * flip it on for every tiny tweak.
 */
export const RETURN_PREVIEW_JSON_SCHEMA = {
  description:
    'If true (or an object), include a base64 scene preview image in the response after this mutation succeeds. Useful for visual self-feedback between upsert batches. Use after layout-sensitive changes; avoid on every small tweak (each preview adds ~1-4 MB of image tokens). Requires the Drawcast desktop app to be running; in headless MCP mode a warning replaces the image.',
  oneOf: [
    { type: 'boolean' },
    {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['png', 'jpeg'],
          description:
            'PNG is lossless (preferred for self-review). JPEG is smaller (user-share).',
        },
        scale: {
          type: 'number',
          minimum: 1,
          maximum: 4,
          description: 'Render scale factor. Default 2 (Retina). Use 3+ to inspect small labels.',
        },
        timeoutMs: {
          type: 'number',
          minimum: 1000,
          maximum: 30000,
          description: 'Maximum wait for the app to reply. Larger scenes need more time.',
        },
      },
    },
  ],
} as const;
