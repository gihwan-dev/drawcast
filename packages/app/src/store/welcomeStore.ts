// Welcome overlay state — persisted to localStorage so "Skip for now"
// (or a successful Connect) doesn't greet the user again on the next
// launch. Kept in its own store (rather than folded into `settingsStore`)
// so the onboarding gate stays decoupled from the rest of settings: you
// can reset a CLI choice in Settings without re-triggering onboarding.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface WelcomeState {
  /**
   * `true` iff the user has acknowledged the welcome overlay — either by
   * connecting a CLI or clicking "Skip for now". The overlay is gated
   * on `!dismissed`, so flipping this to `true` hides it permanently for
   * the current localStorage origin.
   */
  dismissed: boolean;
  /** Mark the overlay as dismissed. Idempotent. */
  dismiss(): void;
  /** Test helper — wipe the persisted value so a fresh state can be set up. */
  reset(): void;
}

export const useWelcomeStore = create<WelcomeState>()(
  persist(
    (set) => ({
      dismissed: false,
      dismiss: () => set({ dismissed: true }),
      reset: () => set({ dismissed: false }),
    }),
    {
      name: 'drawcast-welcome',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
