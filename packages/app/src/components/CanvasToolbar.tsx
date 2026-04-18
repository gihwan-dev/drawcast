// Canvas top-right overlay toolbar — three icon buttons for the
// Copy/Export flows introduced in PR #19 (closes Phase 4).
//
//   1. Copy PNG         — exports the current scene at 2x and writes the
//                         bytes onto the system clipboard as a raster image.
//   2. Copy Excalidraw  — serializes the L2 scene into the
//                         `excalidraw/clipboard` envelope and writes the
//                         JSON as plain text (Excalidraw web + Obsidian
//                         plugin both sniff the envelope on paste).
//   3. Export           — opens a save dialog and writes the chosen
//                         envelope (`.excalidraw` or `.excalidraw.md`) to
//                         disk.
//
// The component stays dumb: it pulls the Excalidraw API out of canvasStore
// and the scene primitives + theme out of sceneStore, then delegates to
// `services/copyExport.ts`. Success surfaces as a toast; errors too, so
// the `arboard::Clipboard::new` failure path on headless Linux CI is
// still reachable by the user.
//
// See docs/06a-ui-design.md — the spec places these affordances at
// `top-4 right-4` inside the canvas container. We position the toolbar at
// `right-dc-md top-dc-md` for consistency with the existing selection
// chip overlay.

import { useCallback, useState } from 'react';
import { Copy, Download, Image } from 'lucide-react';
import {
  copyExcalidraw,
  copyPng,
  exportToFile,
  type ExportOptions,
} from '../services/copyExport.js';
import { useCanvasStore } from '../store/canvasStore.js';
import { useSceneStore } from '../store/sceneStore.js';
import { useToastStore } from '../store/toastStore.js';
import { ResetEditsButton } from './ResetEditsButton.js';

type ActionKind = 'png' | 'excalidraw' | 'export';

export function CanvasToolbar(): JSX.Element {
  const show = useToastStore((s) => s.show);
  const [busy, setBusy] = useState<ActionKind | null>(null);

  const run = useCallback(
    async (kind: ActionKind, body: () => Promise<void>): Promise<void> => {
      if (busy !== null) return;
      setBusy(kind);
      try {
        await body();
      } finally {
        setBusy(null);
      }
    },
    [busy],
  );

  const handleCopyPng = useCallback(() => {
    void run('png', async () => {
      const api = useCanvasStore.getState().api;
      if (api === null) {
        show('Canvas not ready yet', 'error');
        return;
      }
      try {
        await copyPng(api);
        show('Copied PNG to clipboard', 'success');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        show(`Copy PNG failed: ${msg}`, 'error');
      }
    });
  }, [run, show]);

  const handleCopyExcalidraw = useCallback(() => {
    void run('excalidraw', async () => {
      const api = useCanvasStore.getState().api;
      if (api === null) {
        show('Canvas not ready yet', 'error');
        return;
      }
      const { primitives, theme } = useSceneStore.getState();
      try {
        await copyExcalidraw(api, { primitives, theme });
        show('Copied Excalidraw JSON', 'success');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        show(`Copy Excalidraw failed: ${msg}`, 'error');
      }
    });
  }, [run, show]);

  const handleExport = useCallback(
    (format: ExportOptions['format']) => {
      void run('export', async () => {
        const api = useCanvasStore.getState().api;
        if (api === null) {
          show('Canvas not ready yet', 'error');
          return;
        }
        const { primitives, theme } = useSceneStore.getState();
        try {
          const path = await exportToFile(
            api,
            { primitives, theme },
            { format },
          );
          if (path === null) return; // user cancelled
          show(`Exported to ${path}`, 'success');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          show(`Export failed: ${msg}`, 'error');
        }
      });
    },
    [run, show],
  );

  return (
    <div
      data-testid="dc-canvas-toolbar"
      className="pointer-events-auto absolute right-dc-md top-dc-md z-20 flex items-center gap-dc-xs rounded-dc-md border border-dc-border-hairline bg-dc-bg-elevated px-dc-xs py-1 shadow-dc-e1"
    >
      <ToolbarButton
        testId="dc-toolbar-copy-png"
        label="Copy PNG"
        disabled={busy !== null}
        onClick={handleCopyPng}
        icon={<Image size={16} strokeWidth={1.75} />}
      />
      <ToolbarButton
        testId="dc-toolbar-copy-excalidraw"
        label="Copy Excalidraw"
        disabled={busy !== null}
        onClick={handleCopyExcalidraw}
        icon={<Copy size={16} strokeWidth={1.75} />}
      />
      <ToolbarButton
        testId="dc-toolbar-export"
        label="Export as .excalidraw"
        disabled={busy !== null}
        onClick={() => handleExport('excalidraw')}
        icon={<Download size={16} strokeWidth={1.75} />}
      />
      <ResetEditsButton />
    </div>
  );
}

interface ToolbarButtonProps {
  testId: string;
  label: string;
  disabled: boolean;
  onClick(): void;
  icon: JSX.Element;
}

function ToolbarButton(props: ToolbarButtonProps): JSX.Element {
  const { testId, label, disabled, onClick, icon } = props;
  return (
    <button
      type="button"
      data-testid={testId}
      data-tauri-drag-region="false"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-dc-sm text-dc-text-primary transition-colors hover:bg-dc-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
    </button>
  );
}
