// `draw_upsert_edge` tool — connect two primitives (or scene points) with
// an arrow. Corresponds to the `Connector` primitive in `@drawcast/core`.
// See docs/05-mcp-server.md (lines 220-270).

import { z } from 'zod';
import type { Connector, Point, PrimitiveId } from '@drawcast/core';
import { SceneLockError } from '../store.js';
import { lockErrorMessage } from './errors.js';
import {
  defineTool,
  type ToolContentBlock,
  type ToolExecutionResult,
} from './types.js';
import {
  ArrowheadSchema,
  POINT_JSON_SCHEMA,
  PointSchema,
  RETURN_PREVIEW_JSON_SCHEMA,
  ReturnPreviewSchema,
  STYLE_REF_JSON_SCHEMA,
  StyleRefSchema,
  formatZodError,
  normalizeReturnPreview,
  normalizeStyleRef,
} from './utils.js';
import { requestScenePreview } from './helpers/preview.js';
import { sanitizeLabelText } from './helpers/textSanitize.js';

const EndpointSchema = z.union([z.string().min(1), PointSchema]);
const RoutingSchema = z.enum(['straight', 'elbow', 'curved']);
const ArrowheadOrNullSchema = z.union([ArrowheadSchema, z.null()]);

export const drawUpsertEdgeInputSchema = z.object({
  id: z.string().min(1),
  from: EndpointSchema,
  to: EndpointSchema,
  label: z.string().optional(),
  routing: RoutingSchema.optional(),
  arrowhead: z
    .object({
      start: ArrowheadOrNullSchema.optional(),
      end: ArrowheadOrNullSchema.optional(),
    })
    .optional(),
  style: StyleRefSchema.optional(),
  angle: z.number().optional(),
  locked: z.boolean().optional(),
  opacity: z.number().min(0).max(100).optional(),
  returnPreview: ReturnPreviewSchema,
});

export type DrawUpsertEdgeInput = z.infer<typeof drawUpsertEdgeInputSchema>;

const DESCRIPTION =
  'Connect two primitives or scene points with an arrow. Supports straight, elbow, and curved routing. from/to accept either a primitive id (string) for auto-binding or a [x, y] scene point. Pass `returnPreview: true` to receive a PNG snapshot of the scene after the upsert for visual self-review.';

const ENDPOINT_JSON_SCHEMA = {
  description: 'Primitive id (string) or scene coordinate [x, y]',
  oneOf: [{ type: 'string' }, POINT_JSON_SCHEMA],
} as const;

const ARROWHEAD_KINDS = [
  'arrow',
  'triangle',
  'bar',
  'dot',
  'circle',
  'diamond',
  null,
] as const;

/**
 * Normalise an endpoint value into either a `PrimitiveId` brand or a `Point`.
 * The zod schema already narrowed the type — this just performs the
 * branded-string cast, which is unavoidable because `PrimitiveId` is a
 * nominal brand on `string`.
 */
function resolveEndpoint(
  value: string | readonly [number, number],
): PrimitiveId | Point {
  if (typeof value === 'string') {
    return value as PrimitiveId;
  }
  return [value[0], value[1]];
}

/** Human-readable descriptor for the response text. */
function describeEndpoint(value: string | readonly [number, number]): string {
  if (typeof value === 'string') {
    return value;
  }
  return `[${value[0]}, ${value[1]}]`;
}

export const drawUpsertEdge = defineTool({
  name: 'draw_upsert_edge',
  description: DESCRIPTION,
  inputSchema: drawUpsertEdgeInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      from: ENDPOINT_JSON_SCHEMA,
      to: ENDPOINT_JSON_SCHEMA,
      label: { type: 'string', description: 'Optional edge label' },
      routing: {
        type: 'string',
        enum: ['straight', 'elbow', 'curved'],
        description: 'Default "straight"',
      },
      arrowhead: {
        type: 'object',
        properties: {
          start: { enum: ARROWHEAD_KINDS },
          end: { enum: ARROWHEAD_KINDS },
        },
      },
      style: STYLE_REF_JSON_SCHEMA,
      angle: { type: 'number' },
      locked: { type: 'boolean' },
      opacity: { type: 'number' },
      returnPreview: RETURN_PREVIEW_JSON_SCHEMA,
    },
    required: ['id', 'from', 'to'],
  },
  async execute(rawArgs, store, deps): Promise<ToolExecutionResult> {
    const parsed = drawUpsertEdgeInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Invalid input: ${formatZodError(parsed.error)}`,
          },
        ],
      };
    }
    const args = parsed.data;

    const connector: Connector = {
      kind: 'connector',
      id: args.id as PrimitiveId,
      from: resolveEndpoint(args.from),
      to: resolveEndpoint(args.to),
      ...(args.label !== undefined && { label: sanitizeLabelText(args.label) }),
      ...(args.routing !== undefined && { routing: args.routing }),
      ...(args.arrowhead !== undefined && {
        arrowhead: {
          ...(args.arrowhead.start !== undefined && {
            start: args.arrowhead.start,
          }),
          ...(args.arrowhead.end !== undefined && {
            end: args.arrowhead.end,
          }),
        },
      }),
      ...(args.style !== undefined && { style: normalizeStyleRef(args.style) }),
      ...(args.angle !== undefined && { angle: args.angle }),
      ...(args.locked !== undefined && { locked: args.locked }),
      ...(args.opacity !== undefined && { opacity: args.opacity }),
    };

    try {
      store.upsert(connector);
    } catch (err) {
      if (err instanceof SceneLockError) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: lockErrorMessage(err.primitiveId),
            },
          ],
        };
      }
      throw err;
    }

    const fromDesc = describeEndpoint(args.from);
    const toDesc = describeEndpoint(args.to);
    const baseContent: ToolContentBlock[] = [
      {
        type: 'text',
        text: `\u2713 edge ${args.id} ${fromDesc} \u2192 ${toDesc}`,
      },
    ];

    const previewOpts = normalizeReturnPreview(args.returnPreview);
    if (previewOpts === null) {
      return { content: baseContent };
    }
    const preview = await requestScenePreview(deps?.previewBus, previewOpts);
    if (preview.ok) {
      return { content: [...baseContent, preview.image] };
    }
    return {
      content: [
        ...baseContent,
        { type: 'text', text: `(${preview.warning})` },
      ],
    };
  },
});
