// assistant-ui ExternalStoreRuntime adapter. Bridges the Zustand chatStore
// (source of truth, fed by `chat-event` NDJSON) to assistant-ui's Thread
// primitives WITHOUT duplicating state. Conversion happens per render.
//
// Only ChatMessage -> ThreadMessageLike goes here; Composer stays bespoke
// (drag/paste/uploads pipeline is unchanged), so onNew is a fallback
// path for assistant-ui internal shortcuts like edit+resend. The normal
// send flow still runs through useChatStore.sendMessage().
import {
  useExternalStoreRuntime,
  type AppendMessage,
  type ExternalStoreAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import {
  sendChat,
  type AssistantContentBlock,
  type UserContentBlock,
} from '../../services/chat.js';
import { useChatStore, type ChatMessage } from '../../store/chatStore.js';

type ThreadContentPart = Exclude<ThreadMessageLike['content'], string>[number];

function dataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

function convertUserContent(
  blocks: ReadonlyArray<UserContentBlock | AssistantContentBlock>,
): ThreadContentPart[] {
  const parts: ThreadContentPart[] = [];
  for (const b of blocks) {
    if (b.type === 'text') {
      parts.push({ type: 'text', text: b.text });
    } else if (b.type === 'image') {
      parts.push({ type: 'image', image: dataUrl(b.source.media_type, b.source.data) });
    } else if (b.type === 'document') {
      parts.push({
        type: 'file',
        mimeType: b.source.media_type,
        data: dataUrl(b.source.media_type, b.source.data),
      });
    }
  }
  return parts;
}

function convertAssistantContent(
  blocks: ReadonlyArray<AssistantContentBlock>,
): ThreadContentPart[] {
  // Pair tool_use with its matching tool_result by id so the UI sees a
  // single tool-call part per invocation. Orphans (result without a
  // preceding use, or text/image) fall through.
  const resultByUseId = new Map<
    string,
    Extract<AssistantContentBlock, { type: 'tool_result' }>
  >();
  for (const b of blocks) {
    if (b.type === 'tool_result') resultByUseId.set(b.tool_use_id, b);
  }
  const useIds = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'tool_use') useIds.add(b.id);
  }

  const parts: ThreadContentPart[] = [];
  for (const b of blocks) {
    if (b.type === 'text') {
      parts.push({ type: 'text', text: b.text });
      continue;
    }
    if (b.type === 'tool_use') {
      const result = resultByUseId.get(b.id);
      // Only argsText is emitted — ThreadMessageLike's `args` is typed as
      // ReadonlyJSONObject and our `unknown` input doesn't satisfy it
      // under exactOptionalPropertyTypes. ToolCallUI already prefers
      // argsText for display, and assistant-ui parses argsText back into
      // args for downstream consumers that need the structured form.
      const part: ThreadContentPart = {
        type: 'tool-call',
        toolCallId: b.id,
        toolName: b.name,
        argsText: safeStringify(b.input),
        ...(result
          ? { result: result.content, isError: Boolean(result.is_error) }
          : {}),
      };
      parts.push(part);
      continue;
    }
    if (b.type === 'tool_result') {
      // Only render orphans here; matched results were already absorbed
      // into the tool-call part above.
      if (useIds.has(b.tool_use_id)) continue;
      const body = formatToolResult(b.content);
      parts.push({
        type: 'text',
        text:
          `[orphan tool result${b.is_error ? ' | error' : ''}]` +
          (body.length > 0 ? `\n${body}` : ''),
      });
    }
  }
  return parts;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[unserializable]';
  }
}

function formatToolResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (
          typeof part === 'object' &&
          part !== null &&
          'type' in part &&
          (part as { type: unknown }).type === 'text' &&
          'text' in part &&
          typeof (part as { text: unknown }).text === 'string'
        ) {
          return (part as { text: string }).text;
        }
        return null;
      })
      .filter((x): x is string => x !== null)
      .join('\n');
    if (joined.length > 0) return joined;
  }
  return safeStringify(content);
}

function convertMessage(m: ChatMessage): ThreadMessageLike {
  if (m.role === 'user') {
    return {
      id: m.id,
      role: 'user',
      content: convertUserContent(m.content),
      createdAt: new Date(m.createdAt),
    };
  }
  return {
    id: m.id,
    role: 'assistant',
    content: convertAssistantContent(m.content as AssistantContentBlock[]),
    createdAt: new Date(m.createdAt),
    status: m.isStreaming
      ? { type: 'running' }
      : { type: 'complete', reason: 'stop' },
  };
}

const DATA_URL_PATTERN = /^data:([^;]+);base64,(.+)$/;

function parseDataUrl(
  url: string,
): { mediaType: string; data: string } | null {
  const match = url.match(DATA_URL_PATTERN);
  if (!match) return null;
  return { mediaType: match[1]!, data: match[2]! };
}

// Best-effort fallback for assistant-ui driven sends (edit+resend, etc).
// The regular Send button routes through useChatStore.sendMessage() and
// never hits this path.
async function fallbackOnNew(message: AppendMessage): Promise<void> {
  if (message.role !== 'user') return;
  const content: UserContentBlock[] = [];
  for (const p of message.content) {
    if (p.type === 'text') {
      content.push({ type: 'text', text: p.text });
    } else if (p.type === 'image') {
      const parsed = parseDataUrl(p.image);
      if (parsed) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data },
        });
      }
    } else if (p.type === 'file') {
      const parsed = parseDataUrl(p.data);
      const mediaType = p.mimeType || parsed?.mediaType || 'application/octet-stream';
      if (parsed) {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: mediaType, data: parsed.data },
        });
      }
    }
  }
  if (content.length === 0) return;

  const id = `${Date.now().toString(36)}-ext`;
  useChatStore.setState((s) => ({
    messages: [
      ...s.messages,
      {
        id,
        role: 'user',
        content,
        createdAt: Date.now(),
        isStreaming: false,
      },
    ],
    isStreaming: true,
    lastError: null,
  }));
  try {
    await sendChat(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    useChatStore.setState({ isStreaming: false, lastError: msg });
  }
}

export function useDrawcastRuntime() {
  const messages = useChatStore((s) => s.messages);
  const isRunning = useChatStore((s) => s.isStreaming);

  const adapter: ExternalStoreAdapter<ChatMessage> = {
    messages,
    isRunning,
    convertMessage,
    onNew: fallbackOnNew,
    onCancel: async () => {
      await useChatStore.getState().cancelTurn();
    },
  };

  return useExternalStoreRuntime(adapter);
}
