// Tracks whether a CLI child is currently attached and which kind it is.
// Not persisted — every app launch starts with no CLI running.
import { create } from 'zustand';
import type { CliChoice } from '../services/cli.js';

export interface CliState {
  running: boolean;
  which: CliChoice | null;
  setRunning(running: boolean, which?: CliChoice | null): void;
}

export const useCliStore = create<CliState>((set) => ({
  running: false,
  which: null,
  setRunning: (running, which) =>
    set({ running, which: running ? which ?? null : null }),
}));
