// Thin wrapper over the Rust `save_upload` command. All three upload channels
// (drag-drop, clipboard paste, paperclip file picker) funnel through this
// module — keeps the Tauri surface area and the session-path lookup in one
// place so panel code can focus on UX.
//
// The session path is read lazily on each call: uploads may happen at any
// point in a session's lifetime, including shortly after a switch. Reading
// from `sessionStore.getState()` at call time (rather than closing over a
// snapshot) avoids surprising the user with "the file you dropped went to
// the old session dir".

import { invoke } from '@tauri-apps/api/core';
import { useSessionStore } from '../store/sessionStore.js';

export interface SavedUpload {
  /** Basename the bytes were stored under after sanitize + collision suffix. */
  fileName: string;
  /** Absolute path on disk. */
  path: string;
}

function basename(p: string): string {
  const cleaned = p.replace(/\\/g, '/');
  const idx = cleaned.lastIndexOf('/');
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

function requireSessionPath(): string {
  const path = useSessionStore.getState().path;
  if (path === null || path.length === 0) {
    throw new Error('No active session path — cannot save upload');
  }
  return path;
}

/** Low-level: save `data` under the current session's `uploads/` dir. */
export async function saveUpload(
  fileName: string,
  data: ArrayBuffer,
): Promise<SavedUpload> {
  const sessionPath = requireSessionPath();
  const bytes = Array.from(new Uint8Array(data));
  const absolute = await invoke<string>('save_upload', {
    sessionPath,
    filename: fileName,
    data: bytes,
  });
  return { fileName: basename(absolute), path: absolute };
}

/** Save a batch of `File` objects sequentially. Order follows input order. */
export async function saveUploads(files: File[]): Promise<SavedUpload[]> {
  const results: SavedUpload[] = [];
  for (const file of files) {
    const buf = await file.arrayBuffer();
    const saved = await saveUpload(file.name, buf);
    results.push(saved);
  }
  return results;
}

/** Read bytes from an absolute path — used by the paperclip flow after the
 * dialog returns paths. Exposed here so both the picker button and tests
 * can swap it. */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const raw = await invoke<number[]>('read_file_bytes', { path });
  return new Uint8Array(raw);
}
