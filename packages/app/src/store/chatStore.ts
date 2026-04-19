// Chat state: message history, the draft composer, streaming flag, and the
// reducer fed by `chat-event` NDJSON lines. Zustand keeps it flat; the
// reducer switches on `type`/`subtype` so the component code stays thin.
//
// The store is the single source of truth for everything the ChatPanel and
// StatusBar render. Tauri events land in `handleEvent`, which produces
// immutable updates. Components read via selector hooks.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  cancelChat,
  fileToContentBlocks,
  sendChat,
  type AssistantContentBlock,
  type ChatEvent,
  type ChatExitPayload,
  type ChatUsage,
  type RateLimitInfo,
  type UserContentBlock,
} from '../services/chat.js';

// Chat history survives app restarts via localStorage. Scene state is
// already persisted by the MCP server; without this the canvas would
// come back populated while the chat pane showed empty, which reads as
// "the app lost my conversation" (B5).
//
// Cap the persisted list so long-running sessions don't blow past the
// ~5MB localStorage quota. 200 bubbles ≈ well under the limit for pure
// text; image attachments are a known cliff we haven't solved yet.
const MAX_PERSISTED_MESSAGES = 200;

function nanoId(): string {
  // Cheap client-side id. Good enough to key React lists; we don't send
  // these to the server.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface Attachment {
  id: string;
  name: string;
  /** Pre-built content block(s) the composer will splice into the user
   * message when the user hits send. We store blocks rather than raw
   * bytes so the send path is a simple array concat. */
  blocks: UserContentBlock[];
  /** Kind for the chip affordance — distinguishes image vs document vs
   * text-extracted so the chip renders the right icon/label. */
  kind: 'image' | 'document' | 'text';
  sizeBytes: number;
}

export interface ChatDraft {
  text: string;
  attachments: Attachment[];
}

/** A single rendered message bubble. User messages hold the `UserContentBlock`s
 * we sent (so the UI can show the attached files after send); assistant
 * messages accumulate `AssistantContentBlock`s as deltas arrive. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  /** For user: the exact content array we wrote to stdin.
   *  For assistant: content blocks built up from stream-json events. */
  content: Array<UserContentBlock | AssistantContentBlock>;
  /** The claude-side message uuid (assistant only). Used to dedupe when a
   * final `assistant` event arrives after partial deltas. */
  turnUuid?: string;
  createdAt: number;
  isStreaming: boolean;
}

export interface ChatState {
  messages: ChatMessage[];
  draft: ChatDraft;

  // Session metadata from `system/init`
  sessionId: string | null;
  model: string | null;
  apiKeySource: string | null;
  mcpServers: Array<{ name: string; status: string }>;

  rateLimit: RateLimitInfo | null;
  lastCostUsd: number | null;
  lastUsage: ChatUsage | null;
  lastError: string | null;

  isStreaming: boolean;
  /** True once we've seen a `system/init` event since startup. Used by
   *  StatusBar to distinguish "warming up" vs "ready". */
  ready: boolean;

  // Composer actions
  setDraftText(text: string): void;
  appendToDraft(text: string): void;
  addAttachmentFromFile(file: File): Promise<void>;
  removeAttachment(id: string): void;
  clearDraft(): void;

  // Turn control
  sendMessage(): Promise<void>;
  cancelTurn(): Promise<void>;

  // Event pipeline (called by subscribers in ChatPanel)
  handleEvent(ev: ChatEvent): void;
  handleExit(payload: ChatExitPayload): void;

  // Session lifecycle
  reset(): void;
}

const EMPTY_DRAFT: ChatDraft = { text: '', attachments: [] };

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
  messages: [],
  draft: { ...EMPTY_DRAFT },
  sessionId: null,
  model: null,
  apiKeySource: null,
  mcpServers: [],
  rateLimit: null,
  lastCostUsd: null,
  lastUsage: null,
  lastError: null,
  isStreaming: false,
  ready: false,

  setDraftText: (text) => {
    set((s) => ({ draft: { ...s.draft, text } }));
  },

  appendToDraft: (text) => {
    set((s) => {
      const prev = s.draft.text;
      const sep = prev.length > 0 && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : '';
      return { draft: { ...s.draft, text: `${prev}${sep}${text}` } };
    });
  },

  addAttachmentFromFile: async (file) => {
    const blocks = await fileToContentBlocks(file);
    const kind: Attachment['kind'] =
      blocks[0]?.type === 'image'
        ? 'image'
        : blocks[0]?.type === 'document'
          ? 'document'
          : 'text';
    set((s) => ({
      draft: {
        ...s.draft,
        attachments: [
          ...s.draft.attachments,
          {
            id: nanoId(),
            name: file.name,
            blocks,
            kind,
            sizeBytes: file.size,
          },
        ],
      },
    }));
  },

  removeAttachment: (id) => {
    set((s) => ({
      draft: {
        ...s.draft,
        attachments: s.draft.attachments.filter((a) => a.id !== id),
      },
    }));
  },

  clearDraft: () => {
    set({ draft: { ...EMPTY_DRAFT } });
  },

  sendMessage: async () => {
    const { draft, isStreaming } = get();
    if (isStreaming) return;
    const trimmed = draft.text.trim();
    if (trimmed.length === 0 && draft.attachments.length === 0) return;

    // Compose the user message body. Attachments come first so the model
    // sees them as context before the prompt text — matches how the web
    // Anthropic console renders them.
    const content: UserContentBlock[] = [];
    for (const att of draft.attachments) {
      content.push(...att.blocks);
    }
    if (trimmed.length > 0) {
      content.push({ type: 'text', text: trimmed });
    }
    if (content.length === 0) return;

    const msg: ChatMessage = {
      id: nanoId(),
      role: 'user',
      content,
      createdAt: Date.now(),
      isStreaming: false,
    };

    // Optimistic render + clear draft. If send fails, we append an error
    // note below rather than rolling back the optimistic bubble — the
    // user still sees what they tried to send.
    set((s) => ({
      messages: [...s.messages, msg],
      draft: { ...EMPTY_DRAFT },
      isStreaming: true,
      lastError: null,
    }));

    try {
      await sendChat(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ isStreaming: false, lastError: message });
    }
  },

  cancelTurn: async () => {
    try {
      await cancelChat();
    } catch {
      // Ignore — the child was probably already dead.
    }
    set({ isStreaming: false });
  },

  handleEvent: (ev) => {
    // System / init — latch session metadata and mark ready.
    if (ev.type === 'system' && ev.subtype === 'init') {
      set({
        ready: true,
        sessionId: typeof ev.session_id === 'string' ? ev.session_id : null,
        model: typeof ev.model === 'string' ? ev.model : null,
        apiKeySource:
          typeof ev.apiKeySource === 'string' ? ev.apiKeySource : null,
        mcpServers: Array.isArray(ev.mcp_servers)
          ? (ev.mcp_servers as Array<{ name: string; status: string }>)
          : [],
      });
      return;
    }

    // Assistant message — append as new bubble (or update the streaming
    // bubble matching this turnUuid). stream-json emits a fresh
    // `assistant` event per delta when `--include-partial-messages` is on.
    if (ev.type === 'assistant') {
      const assistantEv = ev as Extract<ChatEvent, { type: 'assistant' }>;
      const uuid = typeof assistantEv.uuid === 'string' ? assistantEv.uuid : undefined;
      const incoming = normalizeAssistantContent(
        (assistantEv.message?.content ?? []) as AssistantContentBlock[],
      );
      set((s) => {
        const existingIdx =
          uuid === undefined
            ? -1
            : s.messages.findIndex(
                (m) => m.role === 'assistant' && m.turnUuid === uuid,
              );
        if (incoming.length === 0) return s;
        if (existingIdx >= 0) {
          const updated = [...s.messages];
          updated[existingIdx] = {
            ...updated[existingIdx]!,
            content: mergeAssistantContent(
              updated[existingIdx]!.content as AssistantContentBlock[],
              incoming,
            ),
          };
          return { messages: updated };
        }
        const fresh: ChatMessage = {
          id: nanoId(),
          role: 'assistant',
          content: [...incoming],
          createdAt: Date.now(),
          isStreaming: true,
          ...(uuid !== undefined ? { turnUuid: uuid } : {}),
        };
        return { messages: [...s.messages, fresh] };
      });
      return;
    }

    // Rate limit — mirror into store so StatusBar can render the reset time.
    if (ev.type === 'rate_limit_event') {
      const rlEv = ev as Extract<ChatEvent, { type: 'rate_limit_event' }>;
      set({ rateLimit: rlEv.rate_limit_info });
      return;
    }

    // Turn result — mark the last assistant bubble complete, surface cost.
    if (ev.type === 'result') {
      const resultEv = ev as Extract<ChatEvent, { type: 'result' }>;
      const errMsg = resultEv.is_error
        ? typeof resultEv.result === 'string'
          ? resultEv.result
          : 'unknown error'
        : null;
      set((s) => ({
        messages: s.messages.map((m) =>
          m.role === 'assistant' && m.isStreaming
            ? { ...m, isStreaming: false }
            : m,
        ),
        isStreaming: false,
        lastCostUsd:
          typeof resultEv.total_cost_usd === 'number'
            ? resultEv.total_cost_usd
            : null,
        lastUsage: resultEv.usage ?? null,
        lastError: errMsg,
      }));
      return;
    }

    // `user` replay echo — used by some UIs to confirm delivery. We don't
    // duplicate the bubble (we already appended optimistically in
    // sendMessage); just swallow.
    if (ev.type === 'user') {
      return;
    }

    // Anything else (system/hook_*, partial message previews we don't use,
    // etc.) is ignored.
  },

  handleExit: (payload) => {
    set((s) => ({
      isStreaming: false,
      ready: false,
      messages: s.messages.map((m) =>
        m.role === 'assistant' && m.isStreaming
          ? { ...m, isStreaming: false }
          : m,
      ),
      lastError:
        payload.code === 0 || payload.code === null
          ? s.lastError
          : `chat host exited with code ${payload.code}`,
    }));
  },

  reset: () => {
    set({
      messages: [],
      draft: { ...EMPTY_DRAFT },
      sessionId: null,
      model: null,
      apiKeySource: null,
      mcpServers: [],
      rateLimit: null,
      lastCostUsd: null,
      lastUsage: null,
      lastError: null,
      isStreaming: false,
      ready: false,
    });
  },
    }),
    {
      name: 'drawcast-chat',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // Only the durable slice is persisted. The composer draft belongs to
      // the live session; runtime flags (isStreaming, ready, rateLimit,
      // lastError) must not leak across restarts or the UI comes back
      // mid-stream with no actual child process running.
      partialize: (s) => ({
        messages: s.messages.slice(-MAX_PERSISTED_MESSAGES),
        sessionId: s.sessionId,
        model: s.model,
        apiKeySource: s.apiKeySource,
        mcpServers: s.mcpServers,
        lastCostUsd: s.lastCostUsd,
        lastUsage: s.lastUsage,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.isStreaming = false;
        state.ready = false;
        state.rateLimit = null;
        state.lastError = null;
        state.draft = { ...EMPTY_DRAFT };
      },
    },
  ),
);

/**
 * Merge incoming assistant content blocks into the existing list.
 *
 * stream-json deltas normally come in as cumulative snapshots of the
 * assistant message when `--include-partial-messages` is set — each event
 * carries the full `content` array up to that point, with text blocks
 * growing. The simple strategy: trust the incoming array as the new
 * source of truth. If we ever see genuine patch-style deltas we'd
 * refine here.
 */
function mergeAssistantContent(
  _prev: AssistantContentBlock[],
  next: AssistantContentBlock[],
): AssistantContentBlock[] {
  return [...next];
}

function normalizeAssistantContent(
  blocks: AssistantContentBlock[],
): AssistantContentBlock[] {
  return blocks.filter((b) => {
    if (b.type === 'text') return b.text.trim().length > 0;
    if (b.type === 'thinking') return (b.thinking ?? '').trim().length > 0;
    return true;
  });
}
