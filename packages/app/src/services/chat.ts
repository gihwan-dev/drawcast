// Thin wrapper over Tauri invoke/listen for the chat host backend. Keeps
// the panel + store code unaware of the underlying IPC surface — tests can
// mock this module directly.
//
// `ChatEvent` + friends live in `./chat-events.ts`, where they're inferred
// from the zod schemas that guard every `chat-event` line. This module
// re-exports them so the rest of the frontend has a single import site.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  parseChatEvent,
  parseChatEventLine,
  type AssistantContentBlock,
  type ChatEvent,
  type ChatEventParseResult,
  type ChatUsage,
  type RateLimitInfo,
  type UserContentBlock,
} from './chat-events.js';

// Re-export so the rest of the frontend has a single import site.
export type {
  AssistantContentBlock,
  ChatEvent,
  ChatEventParseResult,
  ChatUsage,
  RateLimitInfo,
  UserContentBlock,
};
export { parseChatEvent, parseChatEventLine };

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

/** Payload shape of the `chat-raw-line` Tauri event — stderr or unparsable
 *  stdout lines. Dev-only; see `subscribeChatRawLines`. */
export interface ChatRawLinePayload {
  stream: 'stdout' | 'stderr';
  line: string;
}

/**
 * Subscribe to every parseable NDJSON line the chat child emits. The raw
 * payload is first routed through the zod parser so consumers get a typed
 * `ChatEvent` either way — schema drift surfaces as a pass-through event
 * plus a `console.debug` log rather than a crash.
 */
export function subscribeChatEvents(
  cb: (ev: ChatEvent) => void,
): () => void {
  let disposed = false;
  let unlisten: UnlistenFn | null = null;
  void (async () => {
    try {
      const fn = await listen<unknown>('chat-event', (ev) => {
        const parsed = parseChatEvent(ev.payload);
        if (parsed.issues.length > 0 && import.meta.env.DEV) {
          // Schema drift we can't silently swallow — devtools-only so
          // prod users never see it, but the event still flows to the
          // store via the pass-through arm.
          // eslint-disable-next-line no-console
          console.debug(
            '[chat-event] schema drift; falling back to raw payload',
            parsed.issues,
            ev.payload,
          );
        }
        cb(parsed.event);
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

/**
 * Subscribe to unparseable stdout or any stderr line from the chat child.
 * Wired only in dev builds so prod users never pay for the listener or see
 * the noise; `console.debug` routes it straight to devtools.
 */
export function subscribeChatRawLines(): () => void {
  if (!import.meta.env.DEV) return () => {};
  let disposed = false;
  let unlisten: UnlistenFn | null = null;
  void (async () => {
    try {
      const fn = await listen<ChatRawLinePayload>('chat-raw-line', (ev) => {
        // eslint-disable-next-line no-console
        console.debug(
          `[chat-raw-line:${ev.payload.stream}]`,
          ev.payload.line,
        );
      });
      if (disposed) fn();
      else unlisten = fn;
    } catch {
      /* non-Tauri contexts — no-op */
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
