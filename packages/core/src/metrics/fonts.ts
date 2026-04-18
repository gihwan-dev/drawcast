// Static font metrics for the 8 Excalidraw FontFamilyId values.
// See docs/03-compile-pipeline.md (lines 177-230) and
// docs/08-excalidraw-reference.md (lines 130-147).
//
// Browser-agnostic, IO-free: these tables are intentional approximations.
// Phase 1 accepts ±10% error vs. real Excalidraw rendering; rely on
// Excalidraw's `restore` to correct measurements on first interaction.

import type { FontFamilyId } from '../theme.js';

export interface FontMetrics {
  /** Average character width multiplier (relative to fontSize). */
  avgCharWidth: number;
  /** Line height multiplier (unitless, matches Excalidraw default). */
  lineHeight: number;
  /** Ascent approximation relative to fontSize. */
  ascent: number;
  /** Descent approximation relative to fontSize (positive, below baseline). */
  descent: number;
}

// Default used when a FontFamilyId isn't explicitly mapped (shouldn't happen
// at runtime because the type is a closed union, but keeps the lookup safe
// under `noUncheckedIndexedAccess`).
const FALLBACK: FontMetrics = {
  avgCharWidth: 0.55,
  lineHeight: 1.25,
  ascent: 0.95,
  descent: 0.27,
};

// Keyed by FontFamilyId numeric literals. Excalifont (5) is the default.
export const EXCALIFONT_METRICS: Record<FontFamilyId, FontMetrics> = {
  // 1: Virgil (legacy hand-drawn).
  1: { avgCharWidth: 0.55, lineHeight: 1.25, ascent: 0.9, descent: 0.3 },
  // 2: Helvetica / system sans. Narrower than Excalifont.
  2: { avgCharWidth: 0.53, lineHeight: 1.15, ascent: 0.92, descent: 0.23 },
  // 3: Cascadia (monospace). Wider average, uniform width.
  3: { avgCharWidth: 0.6, lineHeight: 1.2, ascent: 0.9, descent: 0.25 },
  // 5: Excalifont — default.
  5: { avgCharWidth: 0.55, lineHeight: 1.25, ascent: 0.95, descent: 0.27 },
  // 6: Nunito (rounded sans, slightly wider).
  6: { avgCharWidth: 0.56, lineHeight: 1.25, ascent: 0.95, descent: 0.26 },
  // 7: Lilita One (display, condensed-display feel, slightly wider).
  7: { avgCharWidth: 0.58, lineHeight: 1.3, ascent: 0.95, descent: 0.25 },
  // 8: Comic Shanns (hand-drawn mono feel).
  8: { avgCharWidth: 0.6, lineHeight: 1.25, ascent: 0.92, descent: 0.27 },
  // 9: Liberation Sans (Helvetica-ish).
  9: { avgCharWidth: 0.53, lineHeight: 1.15, ascent: 0.92, descent: 0.23 },
};

/**
 * Return the metrics for a FontFamilyId. Always succeeds — falls back to
 * a conservative default if an id is missing from the table.
 */
export function getFontMetrics(id: FontFamilyId): FontMetrics {
  return EXCALIFONT_METRICS[id] ?? FALLBACK;
}
