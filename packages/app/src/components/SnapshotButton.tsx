// TopBar "📸 Snapshot" button.
//
// Click → export PNG at 2x → save to `{session}/previews/snap-{ts}.png`
// → prefill the active terminal with `@previews/<filename> ` → toast
// "Snapshot saved". Disabled while in flight so a second click doesn't
// double-render.
//
// Scene access goes through `canvasStore` so we don't need to pass the
// Excalidraw API down through the TopBar tree. Session path comes from
// the already-hydrated `sessionStore`.

import { useCallback, useState } from 'react';
import { Camera } from 'lucide-react';
import { takeSnapshot } from '../services/snapshot.js';
import { useCanvasStore } from '../store/canvasStore.js';
import { useChatStore } from '../store/chatStore.js';
import { useSessionStore } from '../store/sessionStore.js';
import { useToastStore } from '../store/toastStore.js';

export function SnapshotButton(): JSX.Element {
  const show = useToastStore((s) => s.show);
  const [busy, setBusy] = useState(false);

  const handleClick = useCallback(async () => {
    if (busy) return;
    const api = useCanvasStore.getState().api;
    const sessionPath = useSessionStore.getState().path;
    if (api === null) {
      show('Canvas not ready yet', 'error');
      return;
    }
    if (sessionPath === null || sessionPath.length === 0) {
      show('No active session — cannot save snapshot', 'error');
      return;
    }

    setBusy(true);
    try {
      const { filename } = await takeSnapshot(api, sessionPath);
      useChatStore.getState().appendToDraft(`@previews/${filename}`);
      show('Snapshot saved', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      show(`Snapshot failed: ${msg}`, 'error');
    } finally {
      setBusy(false);
    }
  }, [busy, show]);

  return (
    <button
      type="button"
      data-testid="dc-snapshot-button"
      data-tauri-drag-region="false"
      aria-label="Take snapshot"
      onClick={() => {
        void handleClick();
      }}
      disabled={busy}
      className="flex h-8 w-8 items-center justify-center rounded-dc-md border border-dc-border-hairline bg-dc-bg-elevated text-dc-text-primary transition-colors hover:bg-dc-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Camera size={16} strokeWidth={1.75} />
    </button>
  );
}
