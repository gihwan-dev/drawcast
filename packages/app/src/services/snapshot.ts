// Snapshot service — user-triggered, not MCP-driven.
//
// The TopBar 📸 button hands us the live Excalidraw API + session path;
// we render a PNG at 2x, save it under `{sessionPath}/previews/snap-
// {timestamp}.png` via the Rust `save_preview_bytes` command (mirror of
// `save_upload`), and return the final filename so the caller can prefill
// the terminal with `@previews/<filename>`.
//
// Unlike the MCP preview flow, this is a plain local-disk write — nothing
// to do with SSE. See docs/07-session-and-ipc.md (Preview Pipeline,
// "명시적 스냅샷 버튼").

import { invoke } from '@tauri-apps/api/core';
import { exportToBlob } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types';

export interface SnapshotResult {
  /** Absolute path the PNG was written to. */
  path: string;
  /** Final basename after sanitization + collision suffixing. */
  filename: string;
}

function basename(p: string): string {
  const cleaned = p.replace(/\\/g, '/');
  const idx = cleaned.lastIndexOf('/');
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

async function blobToBytes(blob: Blob): Promise<number[]> {
  const buf = await blob.arrayBuffer();
  return Array.from(new Uint8Array(buf));
}

/**
 * Render the current scene to PNG and write it under the session's
 * `previews/` directory. Throws if the canvas isn't ready or the Rust
 * command rejects.
 */
export async function takeSnapshot(
  api: ExcalidrawImperativeAPI,
  sessionPath: string,
): Promise<SnapshotResult> {
  const elements = api.getSceneElements();
  const appState = api.getAppState();
  const files = api.getFiles();
  const blob = await exportToBlob({
    elements,
    appState: {
      ...appState,
      exportScale: 2,
    },
    files,
    mimeType: 'image/png',
    exportPadding: 16,
  });

  const bytes = await blobToBytes(blob);
  const filename = `snap-${Date.now()}.png`;
  const absolute = await invoke<string>('save_preview_bytes', {
    sessionPath,
    filename,
    data: bytes,
  });
  return { path: absolute, filename: basename(absolute) };
}
