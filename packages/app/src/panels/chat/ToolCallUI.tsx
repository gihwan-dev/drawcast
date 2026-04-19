// Collapsible card for a single tool-call message part. Serves as the
// `tools.Fallback` in MessagePrimitive.Parts so *every* tool Claude
// invokes — Bash, Read, mcp__drawcast__*, etc. — renders the same way.
//
// Interaction model: React state-driven toggle. A prior revision used a
// native <details>, but assistant-ui re-creates this component on every
// streaming tick (new `status`, new `result` arriving) which wiped the
// implicit `open` flag and made the card look uncollapsible. Explicit
// open state is keyed by toolCallId so index-keyed part remounts do not
// collapse the card immediately after a click.
import { useCallback, useEffect, useState } from 'react';
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';

// `mcp__{server}__{tool}` — double underscore on both sides of the
// server slug. The tool part may itself contain underscores.
const MCP_TOOL_PATTERN = /^mcp__([^_]+)__(.+)$/;
const toolOpenById = new Map<string, boolean>();

function splitName(name: string): { short: string; server: string | null } {
  const match = name.match(MCP_TOOL_PATTERN);
  if (match) return { short: match[2]!, server: match[1]! };
  return { short: name, server: null };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[unserializable]';
  }
}

function formatResult(content: unknown): string {
  if (content === undefined || content === null) return '';
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

export const ToolCallUI: ToolCallMessagePartComponent = ({
  toolCallId,
  toolName,
  args,
  argsText,
  result,
  isError,
  status,
}) => {
  const [open, setOpen] = useState(() => toolOpenById.get(toolCallId) ?? false);

  useEffect(() => {
    setOpen(toolOpenById.get(toolCallId) ?? false);
  }, [toolCallId]);

  const toggleOpen = useCallback(() => {
    setOpen((value) => {
      const next = !value;
      toolOpenById.set(toolCallId, next);
      return next;
    });
  }, [toolCallId]);

  const { short, server } = splitName(toolName);
  const hasResult = result !== undefined;
  const running = !hasResult && status?.type === 'running';
  const indicator = hasResult ? (isError ? 'err' : 'ok') : running ? 'run' : 'wait';
  const indicatorGlyph =
    indicator === 'ok' ? '✓' : indicator === 'err' ? '✕' : indicator === 'run' ? '…' : '·';
  const indicatorCls =
    indicator === 'ok'
      ? 'text-dc-status-success'
      : indicator === 'err'
        ? 'text-dc-status-danger'
        : 'text-dc-text-tertiary';
  const borderCls =
    indicator === 'err' ? 'border-dc-status-danger/60' : 'border-dc-border-hairline';

  const inputText =
    argsText !== undefined && argsText.length > 0 ? argsText : safeStringify(args);
  const resultText = hasResult ? formatResult(result) : '';

  return (
    <div
      data-testid="dc-tool-card"
      data-tool-status={indicator}
      data-open={open ? 'true' : 'false'}
      className={`mt-dc-xs overflow-hidden rounded-dc-sm border ${borderCls} bg-dc-bg-app/60`}
    >
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-dc-xs px-dc-sm py-dc-xs text-left text-[12px] text-dc-text-secondary select-none"
      >
        <span
          aria-hidden
          className="text-dc-text-tertiary transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          ▸
        </span>
        <span aria-hidden>🔧</span>
        <span className="font-mono text-dc-text-primary">{short}</span>
        {server !== null && (
          <span className="rounded-dc-full border border-dc-border-hairline px-[6px] py-[1px] text-[10px] uppercase tracking-wide text-dc-text-tertiary">
            {server}
          </span>
        )}
        <span className={`ml-auto font-mono text-[13px] ${indicatorCls}`} aria-label={`tool ${indicator}`}>
          {indicatorGlyph}
        </span>
      </button>
      {open && (
        <div className="border-t border-dc-border-hairline px-dc-sm py-dc-xs">
          <p className="mb-dc-xs text-[10px] uppercase tracking-wide text-dc-text-tertiary">
            Input
          </p>
          <pre className="dc-scrollbar max-h-60 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-dc-text-secondary">
            {inputText}
          </pre>
          {hasResult && (
            <div className="mt-dc-sm">
              <p className="mb-dc-xs text-[10px] uppercase tracking-wide text-dc-text-tertiary">
                Result
              </p>
              <pre
                className={`dc-scrollbar max-h-60 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed ${
                  isError ? 'text-dc-status-danger' : 'text-dc-text-secondary'
                }`}
              >
                {resultText.length > 0 ? resultText : '(empty)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
