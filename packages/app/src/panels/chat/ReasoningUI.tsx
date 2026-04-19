// Collapsible card for extended-thinking (reasoning) message parts.
// Shape mirrors ToolCallUI so the two stack visually in a thread: same
// border, same chevron, same density. Defaults to collapsed because the
// reasoning block can be long and most users only want it on demand.
//
// Interaction model: React state-driven toggle. Earlier revisions used a
// native <details>, but assistant-ui re-renders message parts on every
// streaming tick and that re-application was resetting the open flag,
// making the card look like it never toggled. Explicit state avoids it.
import { useState } from 'react';
import type { ReasoningMessagePartComponent } from '@assistant-ui/react';

export const ReasoningUI: ReasoningMessagePartComponent = ({ text }) => {
  const [open, setOpen] = useState(false);

  return (
    <div
      data-testid="dc-reasoning-card"
      data-open={open ? 'true' : 'false'}
      className="mt-dc-xs overflow-hidden rounded-dc-sm border border-dc-border-hairline bg-dc-bg-app/50"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
        <span aria-hidden>💭</span>
        <span className="font-mono text-dc-text-primary">Thinking</span>
        <span className="ml-auto font-mono text-[11px] text-dc-text-tertiary">
          {text.length > 0 ? `${text.length} chars` : '…'}
        </span>
      </button>
      {open && (
        <div className="border-t border-dc-border-hairline px-dc-sm py-dc-xs">
          <pre className="dc-scrollbar max-h-80 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-dc-text-secondary">
            {text}
          </pre>
        </div>
      )}
    </div>
  );
};
