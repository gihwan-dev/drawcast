// Settings store — persisted to localStorage so the panel ratio and theme
// survive app restarts. Chat CLI selection is no longer a setting: there is
// exactly one transport (`claude` CLI) and it reuses the user's existing
// OAuth session; a dropdown would have nothing to pick.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark';

export interface SettingsState {
  themeMode: ThemeMode;
  /** 0..1 — fraction of horizontal space given to the left (chat) panel. */
  panelRatio: number;
  setThemeMode(m: ThemeMode): void;
  setPanelRatio(r: number): void;
}

const DEFAULT_PANEL_RATIO = 0.4;

function clampRatio(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_PANEL_RATIO;
  if (r < 0.1) return 0.1;
  if (r > 0.9) return 0.9;
  return r;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'light',
      panelRatio: DEFAULT_PANEL_RATIO,
      setThemeMode: (themeMode) => set({ themeMode }),
      setPanelRatio: (r) => set({ panelRatio: clampRatio(r) }),
    }),
    {
      name: 'drawcast-settings',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (state) => {
        // Drop the legacy `cliChoice` field when loading a v1 payload.
        if (state !== null && typeof state === 'object') {
          const s = state as Partial<SettingsState> & { cliChoice?: unknown };
          if ('cliChoice' in s) {
            delete s.cliChoice;
          }
        }
        return state as SettingsState;
      },
    },
  ),
);
