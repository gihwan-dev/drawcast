// Edit-lock store — mirrors the server-side `editLocks` set so the UI can
// reflect it (e.g. surface the "Reset edits" button only when at least one
// primitive is locked).
//
// Two write paths feed this store:
//   1. `CanvasPanel` detects a user mutation (element `version` bumped without
//      a matching server push) and calls `addLocks([pid])` after POSTing
//      `/edit-lock`.
//   2. Every `SceneSnapshot` pushed from the server carries a `locked` array.
//      `CanvasPanel` forwards it here so the store stays in sync with the
//      source of truth even if the app restarts or another client writes.
//
// Kept deliberately simple: a single set, three mutators. The store does not
// POST anything itself — it's pure local state. Network sync is the caller's
// responsibility, since the reset button needs to POST `{ locked: false }`
// to the server *before* optimistically clearing state.

import { create } from 'zustand';

export interface EditLockState {
  /** Primitive ids currently considered edit-locked on this client. */
  readonly lockedIds: ReadonlySet<string>;
  /** Add one or more ids. Idempotent; unknown ids are retained. */
  addLocks(ids: readonly string[]): void;
  /** Remove one or more ids. Missing ids are a no-op. */
  removeLocks(ids: readonly string[]): void;
  /** Wipe every lock. Used by the "Reset edits" affordance. */
  clearLocks(): void;
  /**
   * Replace the entire locked set with the provided ids. Used by the scene
   * store bridge to mirror the server's authoritative snapshot.
   */
  setLocks(ids: readonly string[]): void;
}

export const useEditLockStore = create<EditLockState>((set) => ({
  lockedIds: new Set<string>(),
  addLocks: (ids) => {
    if (ids.length === 0) return;
    set((state) => {
      let changed = false;
      const next = new Set(state.lockedIds);
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? { lockedIds: next } : state;
    });
  },
  removeLocks: (ids) => {
    if (ids.length === 0) return;
    set((state) => {
      let changed = false;
      const next = new Set(state.lockedIds);
      for (const id of ids) {
        if (next.delete(id)) changed = true;
      }
      return changed ? { lockedIds: next } : state;
    });
  },
  clearLocks: () => {
    set((state) =>
      state.lockedIds.size === 0 ? state : { lockedIds: new Set<string>() },
    );
  },
  setLocks: (ids) => {
    set((state) => {
      if (
        state.lockedIds.size === ids.length &&
        ids.every((id) => state.lockedIds.has(id))
      ) {
        return state;
      }
      return { lockedIds: new Set(ids) };
    });
  },
}));
