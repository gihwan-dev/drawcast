// Session store — tracks the active session dir. Full lifecycle (new /
// switch) lands in PR #15; here we just carry the id + path so the StatusBar
// and sidecar bridge can reference them.
import { create } from 'zustand';

export interface SessionState {
  id: string | null;
  path: string | null;
  setSession(id: string, path: string): void;
  clear(): void;
}

export const useSessionStore = create<SessionState>((set) => ({
  id: null,
  path: null,
  setSession: (id, path) => set({ id, path }),
  clear: () => set({ id: null, path: null }),
}));
