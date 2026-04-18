import { useMcpConnected } from '../mcp/context.js';
import { useSidecarStore } from '../store/sidecarStore.js';

/**
 * 24px bottom strip. Displays sidecar + MCP connection status using the
 * mono-caption type scale from docs/06a-ui-design.md §3.2 / §4.6.
 *
 * The sidecar state (starting/ready/crashed) is strictly about the Rust
 * child process. A separate MCP indicator reports the HTTP/SSE link back
 * to that process — useful once the sidecar is up but the transport
 * hasn't hand-shaken yet.
 */
export function StatusBar(): JSX.Element {
  const status = useSidecarStore((s) => s.status);
  const port = useSidecarStore((s) => s.port);
  const connected = useMcpConnected();

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
    </footer>
  );
}
