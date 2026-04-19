import { useMcpConnected } from '../mcp/context.js';
import { useChatStore } from '../store/chatStore.js';
import { useSidecarStore } from '../store/sidecarStore.js';

/**
 * 24px bottom strip. Shows three independent indicators, in order:
 *
 * 1. MCP sidecar state (starting / ready / crashed) + the auto-picked port.
 * 2. MCP transport link (SSE handshake to that sidecar).
 * 3. Chat host status — whether the `claude -p` child has produced its
 *    `init` event yet, plus the current rate-limit countdown if the last
 *    response surfaced one. `apiKeySource: "none"` is also echoed so the
 *    user can confirm the call is going through OAuth (Pro/Max) rather
 *    than an API key.
 */
export function StatusBar(): JSX.Element {
  const status = useSidecarStore((s) => s.status);
  const port = useSidecarStore((s) => s.port);
  const connected = useMcpConnected();

  const chatReady = useChatStore((s) => s.ready);
  const chatStreaming = useChatStore((s) => s.isStreaming);
  const apiKeySource = useChatStore((s) => s.apiKeySource);
  const rateLimit = useChatStore((s) => s.rateLimit);

  let dotClass = 'bg-dc-text-tertiary';
  let label = 'Starting…';
  if (status === 'ready' && port !== null) {
    dotClass = 'bg-dc-status-success';
    label = `MCP :${port}`;
  } else if (status === 'crashed') {
    dotClass = 'bg-dc-status-danger';
    label = 'MCP crashed';
  }

  const transportLabel =
    status === 'ready' && port !== null
      ? connected
        ? `listening on :${port}`
        : 'disconnected'
      : null;

  const chatDotClass = chatStreaming
    ? 'bg-dc-accent-primary animate-pulse'
    : chatReady
      ? 'bg-dc-status-success'
      : 'bg-dc-text-tertiary';
  const chatLabel = chatStreaming
    ? 'Claude thinking…'
    : chatReady
      ? apiKeySource === 'none'
        ? 'Claude ready · subscription'
        : 'Claude ready'
      : 'Claude idle';

  const rateLimitLabel = rateLimit?.resetsAt
    ? formatResetIn(rateLimit.resetsAt)
    : null;

  return (
    <footer
      role="status"
      aria-live="polite"
      className="flex h-6 items-center border-t border-dc-border-hairline bg-dc-bg-panel px-dc-md font-mono text-[12px] text-dc-text-secondary"
    >
      <span
        aria-hidden="true"
        className={`inline-block h-1.5 w-1.5 rounded-dc-full mr-dc-sm ${dotClass}`}
      />
      <span>{label}</span>
      {transportLabel !== null && (
        <span className="ml-dc-md text-dc-text-tertiary">{transportLabel}</span>
      )}
      <span className="ml-dc-md flex items-center" data-testid="dc-chat-badge">
        <span
          aria-hidden="true"
          className={`inline-block h-1.5 w-1.5 rounded-dc-full mr-dc-sm ${chatDotClass}`}
        />
        <span>{chatLabel}</span>
      </span>
      {rateLimitLabel !== null && (
        <span className="ml-dc-md text-dc-text-tertiary" title={rateLimit?.rateLimitType ?? ''}>
          {rateLimitLabel}
        </span>
      )}
    </footer>
  );
}

/** Format a Unix timestamp (seconds) as "resets in 1h 23m" relative to now.
 * Returns null if the timestamp is in the past or undefined. */
function formatResetIn(resetsAt: number): string | null {
  const now = Math.floor(Date.now() / 1000);
  const diff = resetsAt - now;
  if (diff <= 0) return null;
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (hours > 0) {
    return `resets in ${hours}h ${minutes}m`;
  }
  return `resets in ${minutes}m`;
}
