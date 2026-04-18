// Scene store — holds compiled primitives and the active theme name pushed
// from the MCP sidecar. PR #12 ships an empty typed shell; PR #13 fills it in
// once the SSE client is wired.
import { create } from 'zustand';
import type { Primitive } from '@drawcast/core';

/**
 * Snapshot payload — what the server pushes over SSE. Minimal surface area
 * for PR #12 so downstream PRs can extend without touching callers.
 */
export interface SceneSnapshot {
  primitives: ReadonlyArray<Primitive>;
  theme: string;
  selection?: ReadonlyArray<string>;
  locked?: ReadonlyArray<string>;
}

export interface SceneState {
  readonly primitives: ReadonlyArray<Primitive>;
  readonly theme: string;
  /** Currently selected primitive ids (canvas → CLI sync). */
  readonly selection: ReadonlyArray<string>;
  /** Primitives the user has edited — protected from CLI overwrites. */
  readonly locked: ReadonlyArray<string>;
  setSnapshot(snap: SceneSnapshot): void;
  setSelection(ids: ReadonlyArray<string>): void;
  setLocked(ids: ReadonlyArray<string>): void;
  reset(): void;
}

export const useSceneStore = create<SceneState>((set) => ({
  primitives: [],
  theme: 'sketchy',
  selection: [],
  locked: [],
  setSnapshot: (snap) =>
    set({
      primitives: snap.primitives,
      theme: snap.theme,
      selection: snap.selection ?? [],
      locked: snap.locked ?? [],
    }),
  setSelection: (selection) => set({ selection }),
  setLocked: (locked) => set({ locked }),
  reset: () =>
    set({ primitives: [], theme: 'sketchy', selection: [], locked: [] }),
}));
