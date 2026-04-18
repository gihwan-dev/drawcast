// Session store — tracks the active session (via SessionMeta) plus the list
// of known sessions. Provides an orchestrated `switchTo` that delegates the
// heavy lifting (sidecar restart, CLI teardown) to the Rust side.
//
// The old `setSession` / `setPath` fields are kept so PR #12/#14 callers
// (TerminalPanel, App bootstrap) still work without modification while we
// migrate consumers to the richer `current` shape.
import { create } from 'zustand';
import {
  createSession,
  getCurrentSession,
  listSessions,
  switchSession,
  type SessionMeta,
} from '../services/session.js';

export interface SessionState {
  /** Active session — null until `load()` resolves. */
  current: SessionMeta | null;
  /** All sessions on disk, newest-first. */
  list: SessionMeta[];
  /** Legacy: session id. Preserved for PR #12/#14 callers. */
  id: string | null;
  /** Legacy: session directory path. Preserved for PR #12/#14 callers. */
  path: string | null;
  /** One-shot bootstrap — hydrates `current` + `list`. */
  load(): Promise<void>;
  refreshList(): Promise<void>;
  switchTo(id: string): Promise<void>;
  createAndSwitch(name: string): Promise<void>;
  setCurrent(meta: SessionMeta | null): void;
  /** Legacy setters retained for backwards compatibility. */
  setSession(id: string, path: string): void;
  setPath(path: string): void;
  clear(): void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  current: null,
  list: [],
  id: null,
  path: null,

  load: async () => {
    const [current, list] = await Promise.all([
      getCurrentSession(),
      listSessions(),
    ]);
    set((state) => ({
      ...state,
      current,
      list,
      id: current?.id ?? state.id,
    }));
  },

  refreshList: async () => {
    const list = await listSessions();
    set({ list });
  },

  switchTo: async (id) => {
    const meta = await switchSession(id);
    set((state) => ({
      ...state,
      current: meta,
      id: meta.id,
      // Keep list fresh so timestamps reflect the bump.
      list: state.list.map((s) => (s.id === meta.id ? meta : s)),
    }));
    // Fire-and-forget refresh so ordering (newest-first) is accurate.
    void get().refreshList();
  },

  createAndSwitch: async (name) => {
    const created = await createSession(name);
    set((state) => ({ ...state, list: [created, ...state.list] }));
    await get().switchTo(created.id);
  },

  setCurrent: (meta) =>
    set((state) => ({
      ...state,
      current: meta,
      id: meta?.id ?? state.id,
    })),

  setSession: (id, path) => set({ id, path }),
  setPath: (path) => set({ path }),
  clear: () =>
    set({ id: null, path: null, current: null, list: [] }),
}));
