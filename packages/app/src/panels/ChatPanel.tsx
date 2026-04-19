// Left-side panel: structured chat UI driving the `claude -p` stream-json
// child. Replaces the old xterm-hosted TerminalPanel from PR #14.
//
// Responsibilities:
// - Subscribe to `chat-event` NDJSON stream + `chat-exit` lifecycle event.
// - Render message history (user + assistant bubbles).
// - Host the composer: multiline text input + attachment chips + Send.
// - Drag-drop / paste / picker uploads — each dropped file is BOTH saved
//   into the session's `uploads/` (so Claude's Read tool can reach it by
//   relative path) AND attached as a base64 content block on the next
//   user message (so the vision model can see images and PDFs inline).
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  subscribeChatEvents,
  subscribeChatExit,
  type AssistantContentBlock,
  type UserContentBlock,
} from '../services/chat.js';
import { saveUploads } from '../services/uploads.js';
import { useChatStore, type Attachment, type ChatMessage } from '../store/chatStore.js';
import { useToastStore } from '../store/toastStore.js';

export function ChatPanel(): JSX.Element {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const ready = useChatStore((s) => s.ready);
  const lastError = useChatStore((s) => s.lastError);

  // Wire the event subscribers exactly once per mount. The store owns all
  // state mutations; this component just relays.
  useEffect(() => {
    const offEvents = subscribeChatEvents((ev) => {
      useChatStore.getState().handleEvent(ev);
    });
    const offExit = subscribeChatExit((payload) => {
      useChatStore.getState().handleExit(payload);
    });
    return () => {
      offEvents();
      offExit();
    };
  }, []);

  return (
    <section
      data-testid="dc-chat-panel"
      className="flex h-full w-full flex-col bg-dc-bg-panel"
    >
      <ChatScrollRegion messages={messages} />
      {lastError !== null && (
        <div
          role="alert"
          data-testid="dc-chat-error"
          className="border-t border-dc-border-hairline bg-dc-status-danger/10 px-dc-lg py-dc-sm text-[12px] text-dc-status-danger"
        >
          {lastError}
        </div>
      )}
      <ChatComposer streaming={isStreaming} ready={ready} />
    </section>
  );
}

// -----------------------------------------------------------------------------
// Scroll region: auto-sticks to bottom while the user is near the bottom,
// preserves scroll position if they've scrolled up to read history.

function ChatScrollRegion({ messages }: { messages: ChatMessage[] }): JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el === null) return;
    if (stickyRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (el === null) return;
    const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
    stickyRef.current = distance < 48;
  }, []);

  if (messages.length === 0) {
    return (
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-dc-lg py-dc-lg"
      >
        <ChatEmptyState />
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      data-testid="dc-chat-messages"
      className="flex-1 overflow-y-auto px-dc-lg py-dc-lg"
    >
      <ul className="flex flex-col gap-dc-md">
        {messages.map((m) => (
          <li key={m.id} data-role={m.role}>
            <MessageBubble message={m} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChatEmptyState(): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-dc-text-secondary">
      <p
        className="text-[24px] text-dc-text-primary"
        style={{ fontFamily: 'Excalifont, Virgil, "JetBrains Mono", monospace' }}
      >
        Ready to draw
      </p>
      <p className="mt-dc-sm max-w-[28rem] text-[13px]">
        자연어로 원하는 다이어그램을 설명하거나 이미지·PDF를 드래그해 보세요.
        Claude가 캔버스에 반영합니다.
      </p>
      <p className="mt-dc-sm text-[12px] text-dc-text-tertiary">
        `claude login`이 완료된 Pro/Max 구독 계정이 있어야 합니다.
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Bubble — distinguishes user/assistant; assistant renders text + tool_use
// blocks so the user can see which MCP tool was called and what for.

function MessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  const isUser = message.role === 'user';
  const wrapperClass = isUser
    ? 'ml-auto max-w-[85%] rounded-dc-md bg-dc-accent-primary px-dc-md py-dc-sm text-dc-text-inverse shadow-dc-e1'
    : 'mr-auto max-w-[85%] rounded-dc-md border border-dc-border-hairline bg-dc-bg-elevated px-dc-md py-dc-sm text-dc-text-primary shadow-dc-e1';
  return (
    <div className={wrapperClass} data-testid={isUser ? 'dc-msg-user' : 'dc-msg-assistant'}>
      {message.content.map((block, i) => (
        <BlockRenderer key={i} block={block} dark={isUser} />
      ))}
      {message.isStreaming && !isUser && (
        <span
          className="mt-dc-xs inline-block text-[11px] font-mono text-dc-text-tertiary"
          aria-label="streaming"
        >
          ▍
        </span>
      )}
    </div>
  );
}

function BlockRenderer({
  block,
  dark,
}: {
  block: UserContentBlock | AssistantContentBlock;
  dark: boolean;
}): JSX.Element | null {
  if (block.type === 'text') {
    return (
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
        {block.text}
      </p>
    );
  }
  if (block.type === 'image') {
    // Render attached user images inline (small thumbnail).
    const src = `data:${block.source.media_type};base64,${block.source.data}`;
    return (
      <img
        src={src}
        alt="attached image"
        className="mt-dc-xs max-h-56 rounded-dc-sm border border-dc-border-hairline"
      />
    );
  }
  if (block.type === 'document') {
    return (
      <div
        className={`mt-dc-xs rounded-dc-sm px-dc-sm py-dc-xs text-[12px] ${
          dark ? 'bg-white/10 text-dc-text-inverse/80' : 'bg-dc-bg-app text-dc-text-secondary'
        }`}
      >
        📄 {block.source.media_type}
      </div>
    );
  }
  if (block.type === 'tool_use') {
    return (
      <div
        className="mt-dc-xs rounded-dc-sm border border-dc-border-hairline bg-dc-bg-app/60 px-dc-sm py-dc-xs text-[12px] text-dc-text-secondary"
        data-testid="dc-msg-tool-use"
      >
        <span className="font-mono">🔧 {block.name}</span>
      </div>
    );
  }
  if (block.type === 'tool_result') {
    return (
      <div
        className="mt-dc-xs rounded-dc-sm border border-dc-border-hairline bg-dc-bg-app/60 px-dc-sm py-dc-xs text-[12px] text-dc-text-secondary"
        data-testid="dc-msg-tool-result"
      >
        <span className="font-mono">{block.is_error ? '❌' : '✅'} tool result</span>
      </div>
    );
  }
  return null;
}

// -----------------------------------------------------------------------------
// Composer — text input + attachment chips + send. Also owns the drag-drop
// / paste pipeline for the panel.

interface ComposerProps {
  streaming: boolean;
  ready: boolean;
}

function ChatComposer({ streaming, ready }: ComposerProps): JSX.Element {
  const draft = useChatStore((s) => s.draft);
  const setDraftText = useChatStore((s) => s.setDraftText);
  const removeAttachment = useChatStore((s) => s.removeAttachment);
  const addAttachmentFromFile = useChatStore((s) => s.addAttachmentFromFile);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const cancelTurn = useChatStore((s) => s.cancelTurn);
  const show = useToastStore((s) => s.show);

  const [dragOver, setDragOver] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend =
    !streaming &&
    (draft.text.trim().length > 0 || draft.attachments.length > 0);

  const ingestFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return;
      // Persist bytes to uploads/ so Claude's Read tool can reach them by
      // relative path — keeps parity with the old TerminalPanel flow and
      // unblocks "@uploads/name" prompts.
      try {
        const saved = await saveUploads(files);
        if (saved.length > 0) {
          show(`Saved ${saved.length} file${saved.length === 1 ? '' : 's'}`, 'success');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        show(`Save failed: ${msg}`, 'error');
      }
      // Attach every file (including the ones whose save failed — the
      // blocks still work because they carry the bytes inline).
      for (const f of files) {
        try {
          await addAttachmentFromFile(f);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          show(`Attach failed (${f.name}): ${msg}`, 'error');
        }
      }
    },
    [addAttachmentFromFile, show],
  );

  const handleDragEnter = useCallback(
    (e: ReactDragEvent<HTMLDivElement>): void => {
      e.preventDefault();
      const types = e.dataTransfer?.types;
      if (types) {
        for (let i = 0; i < types.length; i++) {
          if (types[i] === 'Files') {
            setDragOver(true);
            return;
          }
        }
      }
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: ReactDragEvent<HTMLDivElement>): void => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    },
    [],
  );

  const handleDragLeave = useCallback(
    (e: ReactDragEvent<HTMLDivElement>): void => {
      const root = rootRef.current;
      const related = e.relatedTarget as Node | null;
      if (root !== null && related !== null && root.contains(related)) return;
      setDragOver(false);
    },
    [],
  );

  const handleDrop = useCallback(
    async (e: ReactDragEvent<HTMLDivElement>): Promise<void> => {
      e.preventDefault();
      setDragOver(false);
      const list = e.dataTransfer?.files ?? null;
      if (list === null || list.length === 0) return;
      const files: File[] = [];
      for (let i = 0; i < list.length; i++) {
        const f = list.item ? list.item(i) : list[i];
        if (f) files.push(f);
      }
      await ingestFiles(files);
    },
    [ingestFiles],
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLDivElement>): Promise<void> => {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it) continue;
        if (it.kind !== 'file') continue;
        const f = it.getAsFile();
        if (f) files.push(f);
      }
      if (files.length === 0) return;
      e.preventDefault();
      await ingestFiles(files);
    },
    [ingestFiles],
  );

  const onFilePicker = useCallback(
    async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const list = e.target.files;
      if (!list) return;
      const files: File[] = [];
      for (let i = 0; i < list.length; i++) {
        const f = list.item(i);
        if (f) files.push(f);
      }
      // Reset so picking the same file twice still fires change.
      e.target.value = '';
      await ingestFiles(files);
    },
    [ingestFiles],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
      const composing = (e.nativeEvent as { isComposing?: boolean }).isComposing === true;
      if (e.key === 'Enter' && !e.shiftKey && !composing) {
        e.preventDefault();
        if (canSend) {
          void sendMessage();
        }
      }
    },
    [canSend, sendMessage],
  );

  return (
    <div
      ref={rootRef}
      data-testid="dc-chat-composer"
      data-dragging={dragOver ? 'true' : 'false'}
      className="relative border-t border-dc-border-hairline bg-dc-bg-app p-dc-md"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => {
        void handleDrop(e);
      }}
      onPaste={(e) => {
        void handlePaste(e);
      }}
    >
      {draft.attachments.length > 0 && (
        <ul className="mb-dc-sm flex flex-wrap gap-dc-xs" data-testid="dc-chat-attachments">
          {draft.attachments.map((a) => (
            <li key={a.id}>
              <AttachmentChip attachment={a} onRemove={() => removeAttachment(a.id)} />
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-dc-sm">
        <textarea
          ref={textareaRef}
          data-testid="dc-chat-input"
          value={draft.text}
          onChange={(e) => setDraftText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            ready
              ? 'Ask Claude to draw… (Enter to send, Shift+Enter for newline)'
              : '메시지를 입력하면 Claude 세션을 시작합니다…'
          }
          rows={2}
          className="min-h-[44px] flex-1 resize-none rounded-dc-md border border-dc-border-hairline bg-dc-bg-elevated px-dc-sm py-dc-xs text-[13px] text-dc-text-primary placeholder:text-dc-text-tertiary focus:border-dc-border-focus focus:outline-none"
        />
        <button
          type="button"
          data-testid="dc-chat-attach"
          aria-label="Attach files"
          onClick={() => fileInputRef.current?.click()}
          className="flex h-9 w-9 items-center justify-center rounded-dc-md border border-dc-border-hairline bg-dc-bg-elevated text-dc-text-primary transition-colors hover:bg-dc-bg-hover"
        >
          +
        </button>
        {streaming ? (
          <button
            type="button"
            data-testid="dc-chat-cancel"
            onClick={() => {
              void cancelTurn();
            }}
            className="h-9 rounded-dc-md border border-dc-status-danger bg-dc-bg-elevated px-dc-md text-[13px] font-medium text-dc-status-danger transition-colors hover:bg-dc-bg-hover"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            data-testid="dc-chat-send"
            disabled={!canSend}
            onClick={() => {
              void sendMessage();
            }}
            className="h-9 rounded-dc-md bg-dc-accent-primary px-dc-md text-[13px] font-medium text-dc-text-inverse transition-colors hover:bg-dc-accent-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void onFilePicker(e);
        }}
      />
      {dragOver && <DropOverlay />}
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove(): void;
}): JSX.Element {
  const icon =
    attachment.kind === 'image' ? '🖼️' : attachment.kind === 'document' ? '📄' : '📝';
  return (
    <div
      data-testid="dc-chat-chip"
      className="flex items-center gap-dc-xs rounded-dc-full border border-dc-border-hairline bg-dc-bg-elevated px-dc-sm py-0.5 text-[12px] text-dc-text-primary"
    >
      <span>{icon}</span>
      <span className="max-w-[18ch] truncate" title={attachment.name}>
        {attachment.name}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${attachment.name}`}
        className="ml-dc-xs text-dc-text-secondary hover:text-dc-status-danger"
      >
        ×
      </button>
    </div>
  );
}

function DropOverlay(): JSX.Element {
  return (
    <div
      data-testid="dc-drop-overlay"
      aria-label="Drop files to attach"
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-dc-md bg-dc-bg-app/[.92]"
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
      >
        <rect
          x="8"
          y="8"
          width="calc(100% - 16px)"
          height="calc(100% - 16px)"
          fill="none"
          stroke="var(--dc-border-strong, #C9C0AE)"
          strokeWidth="2"
          strokeDasharray="10 6 4 6 8 4"
          strokeLinecap="round"
          rx="6"
        />
      </svg>
      <p
        className="text-[22px] leading-none text-dc-text-primary"
        style={{ fontFamily: 'Excalifont, Virgil, "JetBrains Mono", monospace' }}
      >
        Drop to attach
      </p>
    </div>
  );
}
