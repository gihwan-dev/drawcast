// Toolbar services for Copy-as-PNG / Copy-as-Excalidraw / Export-to-file.
//
// The three flows share the same basic shape: pull the live scene from the
// Excalidraw API or sceneStore, compile if needed, hand the bytes to a
// Rust command. We keep them co-located so the CanvasToolbar component
// stays thin and tests can mock a single module.
//
// Notes on the envelope choice:
//   * copyPng — uses Excalidraw's own `exportToBlob` at 2x scale so the
//     raster result looks reasonable on high-DPI displays. The bytes are
//     handed to `clipboard_write_png`, which decodes + puts the image on
//     the system clipboard.
//   * copyExcalidraw — compiles the L2 scene in-browser to an L1
//     CompileResult, wraps it in the clipboard envelope
//     (`serializeAsClipboardJSON`), and writes the JSON as plain text.
//     Excalidraw web and Obsidian Excalidraw both sniff the envelope on
//     paste, so `text/plain` is sufficient for the MVP (see
//     docs/07-session-and-ipc.md "Copy as Excalidraw").
//   * exportToFile — opens a save dialog, serializes via the matching core
//     helper (excalidraw file vs Obsidian markdown), writes via a Rust
//     command. Returns the saved path or `null` if the user cancelled.
//
// The services take `ClipboardSnapshot` instead of reaching into
// `sceneStore` themselves so tests can inject a deterministic scene
// without wiring up the store.

import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { exportToBlob } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types';
import {
  compile,
  serializeAsClipboardJSON,
  serializeAsExcalidrawFile,
  serializeAsObsidianMarkdown,
  type Primitive,
  type Scene,
} from '@drawcast/core';
import { resolveBuiltinTheme } from '../theme/builtinThemes.js';

/**
 * Snapshot of the L2 scene the toolbar needs to serialize. Mirrors the
 * shape `sceneStore` holds so callers can pass it verbatim.
 */
export interface ClipboardSnapshot {
  primitives: ReadonlyArray<Primitive>;
  theme: string;
}

/** Build an L2 scene from store primitives + theme name. */
function buildScene(snapshot: ClipboardSnapshot): Scene {
  return {
    primitives: new Map(snapshot.primitives.map((p) => [p.id, p])),
    theme: resolveBuiltinTheme(snapshot.theme),
  };
}

async function blobToBytes(blob: Blob): Promise<number[]> {
  const buf = await blob.arrayBuffer();
  return Array.from(new Uint8Array(buf));
}

/**
 * Render the current canvas to a PNG and place it on the system clipboard.
 * Throws if Excalidraw hasn't mounted yet or the Rust command rejects
 * (e.g. no X11 session on a headless CI box).
 */
export async function copyPng(api: ExcalidrawImperativeAPI): Promise<void> {
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
  await invoke('clipboard_write_png', { data: bytes });
}

/**
 * Serialize the current scene as the `excalidraw/clipboard` envelope and
 * write it to the system clipboard as plain text. Excalidraw web and
 * Obsidian Excalidraw both sniff the JSON on paste.
 *
 * `api` is accepted even though unused today to keep a consistent shape
 * with `copyPng` / `exportToFile` and allow a future upgrade to multi-MIME
 * clipboards without changing callers.
 */
export async function copyExcalidraw(
  _api: ExcalidrawImperativeAPI,
  scene: ClipboardSnapshot,
): Promise<void> {
  const compiled = compile(buildScene(scene));
  const envelope = serializeAsClipboardJSON(compiled);
  const text = JSON.stringify(envelope);
  await invoke('clipboard_write_text', { text });
}

export interface ExportOptions {
  format: 'excalidraw' | 'obsidian-markdown';
  /** Suggested filename (without extension) for the save dialog. */
  defaultName?: string;
}

interface ExportSpec {
  ext: string;
  filterName: string;
  build: () => string;
}

function buildExportSpec(
  scene: ClipboardSnapshot,
  format: ExportOptions['format'],
): ExportSpec {
  const compiled = compile(buildScene(scene));
  if (format === 'excalidraw') {
    return {
      ext: 'excalidraw',
      filterName: 'Excalidraw',
      build: () => JSON.stringify(serializeAsExcalidrawFile(compiled), null, 2),
    };
  }
  return {
    ext: 'excalidraw.md',
    filterName: 'Obsidian Excalidraw',
    build: () => serializeAsObsidianMarkdown(compiled),
  };
}

function textToBytes(text: string): number[] {
  const encoder = new TextEncoder();
  return Array.from(encoder.encode(text));
}

/**
 * Open a save dialog and write the selected envelope to disk. Returns the
 * saved path, or `null` if the user cancelled. Any other failure
 * propagates to the caller.
 */
export async function exportToFile(
  _api: ExcalidrawImperativeAPI,
  scene: ClipboardSnapshot,
  options: ExportOptions,
): Promise<string | null> {
  const spec = buildExportSpec(scene, options.format);
  const baseName = options.defaultName ?? 'scene';
  const defaultPath = `${baseName}.${spec.ext}`;

  const chosen = await save({
    defaultPath,
    filters: [{ name: spec.filterName, extensions: [spec.ext] }],
  });
  if (chosen === null || chosen === undefined) {
    return null;
  }
  const bytes = textToBytes(spec.build());
  const saved = await invoke<string>('save_export_bytes', {
    path: chosen,
    data: bytes,
  });
  return saved;
}
