// Canvas-API store.
//
// Shares the Excalidraw imperative API handle across the tree so non-canvas
// consumers (the snapshot button, the preview handler in CanvasPanel's
// effect chain) can reach export / scene-query methods without prop
// drilling through panels.
//
// Rules:
//   - CanvasPanel calls `setApi(api)` when Excalidraw's
//     `excalidrawAPI` callback fires, and `setApi(null)` on unmount.
//   - Consumers read `getState().api` at call time rather than subscribing
//     — the API object identity doesn't change between renders, so pulling
//     it imperatively is both safe and avoids unnecessary re-renders.
//
// See docs/06-app-shell.md (store layout).

import { create } from 'zustand';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types';

export interface CanvasState {
  /** Live imperative handle, or null if the canvas hasn't mounted yet. */
  api: ExcalidrawImperativeAPI | null;
  setApi(api: ExcalidrawImperativeAPI | null): void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  api: null,
  setApi: (api) => set({ api }),
}));
