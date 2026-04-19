// Thin wrapper over Tauri invoke/listen for the chat host backend. Keeps
// the panel + store code unaware of the underlying IPC surface — tests can
// mock this module directly.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// -----------------------------------------------------------------------------
// Content blocks — standard Anthropic message schema. We serialize these
// straight into the `content` array of a stream-json user message.

export type UserContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    }
  | {
      type: 'document';
      source: { type: 'base64'; media_type: string; data: string };
    };

export type AssistantContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: unknown;
      is_error?: boolean;
    };

// -----------------------------------------------------------------------------
// Stream-json event shapes. Rust emits `chat-event` with the raw parsed
// JSON line; the discriminator is the top-level `type` field (plus
// `subtype` for `system` and `result`).

export interface ChatUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  service_tier?: string;
}

export interface RateLimitInfo {
  status: string;
  resetsAt?: number;
  rateLimitType?: string;
  overageStatus?: string;
  overageDisabledReason?: string;
  isUsingOverage?: boolean;
}

export type ChatEvent =
  | {
      type: 'system';
      subtype: 'init';
      session_id?: string;
      model?: string;
      apiKeySource?: string;
      mcp_servers?: Array<{ name: string; status: string }>;
      tools?: string[];
      permissionMode?: string;
      [key: string]: unknown;
    }
  | {
      type: 'system';
      subtype: string;
      [key: string]: unknown;
    }
  | {
      type: 'assistant';
      message: {
        id?: string;
        model?: string;
        role: 'assistant';
        content: AssistantContentBlock[];
        usage?: ChatUsage;
        stop_reason?: string | null;
        stop_sequence?: string | null;
      };
      session_id?: string;
      uuid?: string;
      parent_tool_use_id?: string | null;
    }
  | {
      type: 'user';
      message: { role: 'user'; content: UserContentBlock[] };
      session_id?: string;
      uuid?: string;
    }
  | {
      type: 'result';
      subtype?: string;
      is_error: boolean;
      api_error_status?: number | null;
      duration_ms?: number;
      duration_api_ms?: number;
      num_turns?: number;
      result?: string;
      total_cost_usd?: number;
      usage?: ChatUsage;
      session_id?: string;
      uuid?: string;
      terminal_reason?: string;
    }
  | {
      type: 'rate_limit_event';
      rate_limit_info: RateLimitInfo;
      session_id?: string;
      uuid?: string;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

export interface ChatExitPayload {
  code: number | null;
}

// -----------------------------------------------------------------------------
// Commands

/**
 * Send a user message. The backend lazily spawns `claude` on first use and
 * keeps it alive across turns. `content` must already be an array of
 * standard Anthropic content blocks.
 */
export async function sendChat(content: UserContentBlock[]): Promise<void> {
  await invoke('chat_send', { content });
}

/**
 * Cancel the in-flight turn by killing the child. Next `sendChat` respawns
 * with a fresh session id (conversation memory is lost on cancel until we
 * wire up `--resume`).
 */
export async function cancelChat(): Promise<void> {
  await invoke('chat_cancel');
}

/** Graceful shutdown — idempotent, safe to call on unmount. */
export async function shutdownChat(): Promise<void> {
  await invoke('chat_shutdown');
}

/**
 * Welcome onboarding probe — returns `true` iff the `claude` binary is
 * resolvable. A `true` value does NOT guarantee the user is logged in; a
 * failing `sendChat` with an `authentication_error` is the canonical
 * signal for "run `claude login`".
 */
export async function checkClaudeInstalled(): Promise<boolean> {
  try {
    return await invoke<boolean>('check_claude_installed');
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// Event subscribers

/** Subscribe to every NDJSON line the chat child emits. Returns disposer. */
export function subscribeChatEvents(
  cb: (ev: ChatEvent) => void,
): () => void {
  let disposed = false;
  let unlisten: UnlistenFn | null = null;
  void (async () => {
    try {
      const fn = await listen<ChatEvent>('chat-event', (ev) => {
        cb(ev.payload);
      });
      if (disposed) fn();
      else unlisten = fn;
    } catch {
      // Non-Tauri contexts (tests / storybook) stub listen(), so the
      // handler simply never fires. That's fine.
    }
  })();
  return () => {
    disposed = true;
    if (unlisten !== null) {
      unlisten();
      unlisten = null;
    }
  };
}

/** Subscribe to the chat-exit event (fires once per child lifetime). */
export function subscribeChatExit(
  cb: (payload: ChatExitPayload) => void,
): () => void {
  let disposed = false;
  let unlisten: UnlistenFn | null = null;
  void (async () => {
    try {
      const fn = await listen<ChatExitPayload>('chat-exit', (ev) => {
        cb(ev.payload);
      });
      if (disposed) fn();
      else unlisten = fn;
    } catch {
      /* see subscribeChatEvents */
    }
  })();
  return () => {
    disposed = true;
    if (unlisten !== null) {
      unlisten();
      unlisten = null;
    }
  };
}

// -----------------------------------------------------------------------------
// Session path fetch — kept here because the previous `services/cli.ts`
// owned it and the rest of the frontend imports from a single module.

export async function getDefaultSessionPath(): Promise<string | null> {
  try {
    return await invoke<string>('get_default_session_path');
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Browser File → base64 helper used by attachment flow.
// Kept here because both the store and any ad-hoc callers benefit from the
// same MIME-aware block construction.

const TEXT_LIKE_SUFFIXES = [
  '.md',
  '.markdown',
  '.txt',
  '.csv',
  '.tsv',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.log',
];

function isProbablyText(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  const lower = file.name.toLowerCase();
  return TEXT_LIKE_SUFFIXES.some((ext) => lower.endsWith(ext));
}

function bufferToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(bin);
}

/**
 * Turn a browser File into one or more user content blocks:
 *  - image/* → `image` block with base64
 *  - application/pdf → `document` block
 *  - text-like (markdown, plain text, csv, json, …) → `text` block,
 *    wrapped with a `# filename` header so the model sees the filename
 *  - anything else → `text` block with a best-effort utf-8 decode,
 *    same filename wrapper
 */
export async function fileToContentBlocks(
  file: File,
): Promise<UserContentBlock[]> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (file.type.startsWith('image/')) {
    return [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: file.type,
          data: bufferToBase64(bytes),
        },
      },
    ];
  }

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: bufferToBase64(bytes),
        },
      },
    ];
  }

  if (isProbablyText(file)) {
    const text = new TextDecoder('utf-8').decode(bytes);
    return [
      {
        type: 'text',
        text: `# ${file.name}\n\n${text}`,
      },
    ];
  }

  // Fallback: best-effort text decode for unknown MIME. If that fails,
  // the model sees the filename + a note about binary content.
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return [{ type: 'text', text: `# ${file.name}\n\n${text}` }];
  } catch {
    return [
      {
        type: 'text',
        text: `# ${file.name}\n\n[${bytes.length} bytes of binary data; please ask the user to re-attach as an image or PDF]`,
      },
    ];
  }
}
