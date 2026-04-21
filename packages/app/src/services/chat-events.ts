// Runtime schema for the NDJSON lines `claude -p --output-format stream-json`
// emits. Rust forwards each line verbatim over the `chat-event` Tauri event;
// CLI versions have historically added or renamed fields without warning, so
// we treat every payload as untrusted and validate before handing it to the
// store. Unknown fields are preserved (`.passthrough`) so the reducer can
// still read them via the fallthrough `[key: string]: unknown` variant.
//
// Parse failures never throw — the parser returns the original raw value
// with an `issues` array so callers can decide whether to log or surface.

import { z } from 'zod';

// -----------------------------------------------------------------------------
// Content blocks

export const userContentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('image'),
    source: z.object({
      type: z.literal('base64'),
      media_type: z.string(),
      data: z.string(),
    }),
  }),
  z.object({
    type: z.literal('document'),
    source: z.object({
      type: z.literal('base64'),
      media_type: z.string(),
      data: z.string(),
    }),
  }),
]);

export const assistantContentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('thinking'),
    thinking: z.string(),
    signature: z.string().optional(),
  }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
  z.object({
    type: z.literal('tool_result'),
    tool_use_id: z.string(),
    content: z.unknown(),
    is_error: z.boolean().optional(),
  }),
]);

// -----------------------------------------------------------------------------
// Shared sub-shapes

export const chatUsageSchema = z
  .object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    cache_creation_input_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
    service_tier: z.string().optional(),
  })
  .passthrough();

export const rateLimitInfoSchema = z
  .object({
    status: z.string(),
    resetsAt: z.number().optional(),
    rateLimitType: z.string().optional(),
    overageStatus: z.string().optional(),
    overageDisabledReason: z.string().optional(),
    isUsingOverage: z.boolean().optional(),
  })
  .passthrough();

// -----------------------------------------------------------------------------
// Top-level event variants

const systemInitSchema = z
  .object({
    type: z.literal('system'),
    subtype: z.literal('init'),
    session_id: z.string().optional(),
    model: z.string().optional(),
    apiKeySource: z.string().optional(),
    mcp_servers: z
      .array(z.object({ name: z.string(), status: z.string() }).passthrough())
      .optional(),
    tools: z.array(z.string()).optional(),
    permissionMode: z.string().optional(),
  })
  .passthrough();

const systemOtherSchema = z
  .object({
    type: z.literal('system'),
    subtype: z.string(),
  })
  .passthrough();

const assistantEventSchema = z
  .object({
    type: z.literal('assistant'),
    message: z
      .object({
        id: z.string().optional(),
        model: z.string().optional(),
        role: z.literal('assistant'),
        content: z.array(assistantContentBlockSchema),
        usage: chatUsageSchema.optional(),
        stop_reason: z.string().nullable().optional(),
        stop_sequence: z.string().nullable().optional(),
      })
      .passthrough(),
    session_id: z.string().optional(),
    uuid: z.string().optional(),
    parent_tool_use_id: z.string().nullable().optional(),
  })
  .passthrough();

const userEventSchema = z
  .object({
    type: z.literal('user'),
    message: z
      .object({
        role: z.literal('user'),
        content: z.array(userContentBlockSchema),
      })
      .passthrough(),
    session_id: z.string().optional(),
    uuid: z.string().optional(),
  })
  .passthrough();

const resultEventSchema = z
  .object({
    type: z.literal('result'),
    subtype: z.string().optional(),
    is_error: z.boolean(),
    api_error_status: z.number().nullable().optional(),
    duration_ms: z.number().optional(),
    duration_api_ms: z.number().optional(),
    num_turns: z.number().optional(),
    result: z.string().optional(),
    total_cost_usd: z.number().optional(),
    usage: chatUsageSchema.optional(),
    session_id: z.string().optional(),
    uuid: z.string().optional(),
    terminal_reason: z.string().optional(),
  })
  .passthrough();

const rateLimitEventSchema = z
  .object({
    type: z.literal('rate_limit_event'),
    rate_limit_info: rateLimitInfoSchema,
    session_id: z.string().optional(),
    uuid: z.string().optional(),
  })
  .passthrough();

// Known strict schemas keyed by the top-level `type`. `system` has two
// variants keyed by `subtype`; we try `init` first and fall back to the
// permissive shape.
const STRICT_SYSTEM_SCHEMAS = [systemInitSchema, systemOtherSchema] as const;

const STRICT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  assistant: assistantEventSchema,
  user: userEventSchema,
  result: resultEventSchema,
  rate_limit_event: rateLimitEventSchema,
};

// -----------------------------------------------------------------------------
// Public types — mirror the shape the store + runtime consume. Inferring
// from zod keeps the runtime and compile-time views in lockstep.

export type UserContentBlock = z.infer<typeof userContentBlockSchema>;
export type AssistantContentBlock = z.infer<typeof assistantContentBlockSchema>;
export type ChatUsage = z.infer<typeof chatUsageSchema>;
export type RateLimitInfo = z.infer<typeof rateLimitInfoSchema>;

/**
 * Full event union. The trailing `{ type: string; ... }` is the pass-through
 * arm — anything we don't recognize (future CLI variants, unknown system
 * subtypes) surfaces here with a string discriminator plus untyped extras.
 */
export type ChatEvent =
  | z.infer<typeof systemInitSchema>
  | z.infer<typeof systemOtherSchema>
  | z.infer<typeof assistantEventSchema>
  | z.infer<typeof userEventSchema>
  | z.infer<typeof resultEventSchema>
  | z.infer<typeof rateLimitEventSchema>
  | { type: string; [key: string]: unknown };

export interface ChatEventParseResult {
  event: ChatEvent;
  /**
   * Non-empty when the payload was recognizable but failed strict
   * validation, or when the envelope itself was malformed. Consumers can
   * forward these to devtools. The `event` is still usable — unknown
   * variants pass through unchanged, so a reducer branching on
   * `type`/`subtype` will simply take the fallthrough path.
   */
  issues: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => {
    const path = i.path.length > 0 ? i.path.join('.') : '<root>';
    return `${path}: ${i.message}`;
  });
}

/**
 * Parse a raw value (typically the decoded JSON of an NDJSON line) into a
 * `ChatEvent`. Never throws: on strict-schema failure it returns the raw
 * value as a pass-through event plus an `issues` list describing the drift.
 */
export function parseChatEvent(raw: unknown): ChatEventParseResult {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return {
      event: { type: 'unknown', raw } as ChatEvent,
      issues: ['payload is not an object with a string `type` field'],
    };
  }

  if (raw.type === 'system') {
    for (const schema of STRICT_SYSTEM_SCHEMAS) {
      const parsed = schema.safeParse(raw);
      if (parsed.success) {
        return { event: parsed.data as ChatEvent, issues: [] };
      }
    }
    // Both system schemas failed — fall through to pass-through with the
    // permissive schema's issue list (most informative about what's missing).
    const fallback = systemOtherSchema.safeParse(raw);
    return {
      event: raw as ChatEvent,
      issues: fallback.success ? [] : formatIssues(fallback.error),
    };
  }

  const schema = STRICT_SCHEMAS[raw.type];
  if (!schema) {
    // Unknown type — not an error, just a newer CLI. Keep it raw.
    return { event: raw as ChatEvent, issues: [] };
  }

  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return { event: parsed.data as ChatEvent, issues: [] };
  }
  return {
    event: raw as ChatEvent,
    issues: formatIssues(parsed.error),
  };
}

/**
 * Parse a single NDJSON line. Accepts whitespace-only lines (returns null)
 * so callers iterating over a multi-line fixture can skip them cleanly.
 * Invalid JSON surfaces as a parse result with `issues` describing the
 * failure, mirroring Rust's `chat-raw-line` emission path on the producer
 * side.
 */
export function parseChatEventLine(
  line: string,
): ChatEventParseResult | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      event: { type: 'unknown', line: trimmed } as ChatEvent,
      issues: [`JSON parse failed: ${message}`],
    };
  }
  return parseChatEvent(raw);
}
