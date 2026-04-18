// Toast store — transient, auto-dismiss notifications. Used by the upload
// flows to confirm "Saved N file(s)" and to surface errors from the Tauri
// command path.
//
// Design constraints:
// - No external deps (no react-toastify etc.) — the spec asked for minimal UI.
// - Auto-dismiss after 3s. Each toast carries its own timer so a rapid burst
//   dismisses in FIFO order without extra bookkeeping.
// - Identifiers are monotonically increasing integers so React can key on
//   them without colliding across mounts.
import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const AUTO_DISMISS_MS = 3000;

export interface ToastState {
  toasts: Toast[];
  show(message: string, kind?: ToastKind): number;
  dismiss(id: number): void;
  clear(): void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, kind = 'info') => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }));
    // Schedule auto-dismiss. In jsdom/tests consumers can call `dismiss`
    // manually or drain via `clear()` — the timeout is harmless either way.
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        get().dismiss(id);
      }, AUTO_DISMISS_MS);
    }
    return id;
  },
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));
