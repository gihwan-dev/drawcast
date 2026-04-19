// Thin wrapper over the Tauri `session_*` commands. The Rust side emits
// `camelCase` JSON via `#[serde(rename_all = "camelCase")]`, so the TS
// shape is a 1:1 mirror of `session::SessionMeta`.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface SessionMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Historical field from the pre-chat architecture. Kept optional so
   * existing session directories still deserialize; new code ignores it. */
  cliChoice?: string | null;
  theme: string;
  lastKnownPort: number | null;
}

export async function listSessions(): Promise<SessionMeta[]> {
  try {
    return (await invoke<SessionMeta[]>('list_sessions')) ?? [];
  } catch {
    return [];
  }
}

export async function createSession(name: string): Promise<SessionMeta> {
  return await invoke<SessionMeta>('create_session', { name });
}

export async function switchSession(id: string): Promise<SessionMeta> {
  return await invoke<SessionMeta>('switch_session', { id });
}

export async function getCurrentSession(): Promise<SessionMeta | null> {
  try {
    const meta = await invoke<SessionMeta | null>('get_current_session');
    return meta ?? null;
  } catch {
    return null;
  }
}

/**
 * Subscribe to the `session-switched` event emitted by Rust after a switch
 * completes. The payload is the new meta; frontend consumers use this to
 * clear sceneStore, reset the MCP client, etc.
 */
export function subscribeSessionSwitched(
  cb: (meta: SessionMeta) => void,
): () => void {
  let disposed = false;
  let unlisten: UnlistenFn | null = null;
  void (async () => {
    try {
      const fn = await listen<SessionMeta>('session-switched', (ev) => {
        cb(ev.payload);
      });
      if (disposed) fn();
      else unlisten = fn;
    } catch {
      // In non-Tauri contexts (tests / storybook) the listen mock returns a
      // no-op disposer — there's nothing to do.
    }
  })();
  return () => {
    disposed = true;
    if (unlisten !== null) {
      unlisten();
      unlisten = null;
    }
  };
}
