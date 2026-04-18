// Settings store — persisted to localStorage so the panel ratio, theme, and
// CLI choice survive app restarts.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark';
export type CliChoice = 'claude-code' | 'codex' | null;

export interface SettingsState {
  themeMode: ThemeMode;
  cliChoice: CliChoice;
  /** 0..1 — fraction of horizontal space given to the left (terminal) panel. */
  panelRatio: number;
  setThemeMode(m: ThemeMode): void;
  /**
   * Persist the user's preferred CLI. `null` represents "no CLI attached" —
   * matches the CliSelect "None" option.
   */
  setCliChoice(c: CliChoice): void;
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
      cliChoice: null,
      panelRatio: DEFAULT_PANEL_RATIO,
      setThemeMode: (themeMode) => set({ themeMode }),
      setCliChoice: (cliChoice) => set({ cliChoice }),
      setPanelRatio: (r) => set({ panelRatio: clampRatio(r) }),
    }),
    {
      name: 'drawcast-settings',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
