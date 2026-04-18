// Lightweight local store for sidecar status. Not persisted — every app
// launch re-spawns the sidecar and renegotiates the port.
import { create } from 'zustand';

export type SidecarStatus = 'starting' | 'ready' | 'crashed' | 'unknown';

export interface SidecarState {
  status: SidecarStatus;
  port: number | null;
  lastExitCode: number | null;
  setStarting(): void;
  setReady(port: number): void;
  setCrashed(code: number | null): void;
}

export const useSidecarStore = create<SidecarState>((set) => ({
  status: 'starting',
  port: null,
  lastExitCode: null,
  setStarting: () => set({ status: 'starting', port: null }),
  setReady: (port) => set({ status: 'ready', port, lastExitCode: null }),
  setCrashed: (code) =>
    set({ status: 'crashed', port: null, lastExitCode: code }),
}));
