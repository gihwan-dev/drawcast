// Paperclip file picker in the TopBar. Opens the native Tauri dialog,
// reads the chosen files via a lightweight Rust command, and funnels them
// through `saveUploads` so the resulting notifications match the drag-drop
// / paste flows.
//
// We reach for `@tauri-apps/plugin-dialog` for the picker (native multi-file
// support comes with accessibility hooks and keyboard affordances for free),
// and keep a local `read_file_bytes` Rust command instead of pulling in
// `tauri-plugin-fs` wholesale — the fs plugin's capability surface is
// overkill for a single read.
import { useCallback, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFileBytes, saveUpload } from '../services/uploads.js';
import { useToastStore } from '../store/toastStore.js';

function basename(p: string): string {
  const cleaned = p.replace(/\\/g, '/');
  const idx = cleaned.lastIndexOf('/');
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

export function UploadButton(): JSX.Element {
  const show = useToastStore((s) => s.show);
  const [busy, setBusy] = useState(false);

  const handleClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const selection = await open({
        multiple: true,
        title: 'Attach files',
        filters: [
          {
            name: 'Common upload',
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'pdf', 'txt', 'md', 'excalidraw'],
          },
        ],
      });
      const paths = Array.isArray(selection)
        ? selection
        : selection !== null && selection !== undefined
          ? [selection as unknown as string]
          : [];
      // `open` returns an array of strings for `multiple: true`, `null` when
      // the user cancels. Normalize both shapes to a plain string list.
      if (paths.length === 0) return;

      let saved = 0;
      for (const raw of paths) {
        const path = typeof raw === 'string' ? raw : String(raw);
        try {
          const bytes = await readFileBytes(path);
          // Copy into a fresh ArrayBuffer so the type is invariant over the
          // subarray's buffer kind (can be SharedArrayBuffer in some hosts).
          const buf = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(buf).set(bytes);
          await saveUpload(basename(path), buf);
          saved += 1;
        } catch (err) {
          // Surface the per-file failure but keep going so a multi-file pick
          // doesn't abort on the first bad file.
          // eslint-disable-next-line no-console
          console.warn('[upload] read failed', path, err);
          show(`Upload failed: ${basename(path)}`, 'error');
        }
      }
      if (saved > 0) {
        show(`Saved ${saved} file${saved === 1 ? '' : 's'}`, 'success');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      show(`Upload failed: ${msg}`, 'error');
    } finally {
      setBusy(false);
    }
  }, [busy, show]);

  return (
    <button
      type="button"
      data-testid="dc-upload-button"
      data-tauri-drag-region="false"
      aria-label="Attach files"
      onClick={handleClick}
      disabled={busy}
      className="flex h-8 w-8 items-center justify-center rounded-dc-md border border-dc-border-hairline bg-dc-bg-elevated text-dc-text-primary transition-colors hover:bg-dc-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Paperclip size={16} strokeWidth={1.75} />
    </button>
  );
}
