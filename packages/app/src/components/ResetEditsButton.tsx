// "Reset edits" toolbar button — clears every primitive that has been
// flagged as user-edited on this client.
//
// Visibility is gated by `useEditLockStore.lockedIds.size > 0`; when the
// set is empty the component renders nothing so the toolbar stays quiet in
// the common case.
//
// Click flow:
//   1. Capture the current locked id list.
//   2. POST `/edit-lock { ids, locked: false }` to the MCP server. If the
//      server rejects (offline, for instance) surface a toast and DO NOT
//      clear the local set — that would desync us from the server.
//   3. On success, clear the local `editLockStore` and show a confirmation
//      toast.
//
// The store's `setLocks` path is also wired up on every incoming snapshot,
// so even if this optimistic ack beats the server's scene re-push we'll
// converge on the correct state.

import { useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import { useMcp } from '../mcp/context.js';
import { useEditLockStore } from '../store/editLockStore.js';
import { useToastStore } from '../store/toastStore.js';

export function ResetEditsButton(): JSX.Element | null {
  const lockedIds = useEditLockStore((s) => s.lockedIds);
  const clearLocks = useEditLockStore((s) => s.clearLocks);
  const show = useToastStore((s) => s.show);
  const client = useMcp();

  const handleClick = useCallback(() => {
    const ids = [...lockedIds];
    if (ids.length === 0) return;

    void (async () => {
      if (client !== null) {
        try {
          await client.postEditLock(ids, false);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          show(`Reset edits failed: ${msg}`, 'error');
          return;
        }
      }
      clearLocks();
      show('Edits reset', 'success');
    })();
  }, [lockedIds, clearLocks, show, client]);

  if (lockedIds.size === 0) return null;

  const label =
    lockedIds.size === 1 ? 'Reset 1 edit' : `Reset ${lockedIds.size} edits`;

  return (
    <button
      type="button"
      data-testid="dc-toolbar-reset-edits"
      data-tauri-drag-region="false"
      aria-label={label}
      title={label}
      onClick={handleClick}
      className="flex h-8 items-center gap-dc-xs rounded-dc-sm px-dc-sm text-[12px] text-dc-text-primary transition-colors hover:bg-dc-bg-hover"
    >
      <RotateCcw size={14} strokeWidth={1.75} />
      <span>{label}</span>
    </button>
  );
}
