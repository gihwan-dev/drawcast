// Deterministic text measurement. Purely static — no canvas, no DOM, no IO.
// See docs/03-compile-pipeline.md (lines 177-230).

import { getFontMetrics } from './metrics/fonts.js';
import type { FontFamilyId } from './theme.js';

export interface MeasureParams {
  text: string;
  fontSize: number;
  fontFamily: FontFamilyId;
  /** Optional override for the font's default line height multiplier. */
  lineHeight?: number;
}

export interface TextMetrics {
  width: number;
  height: number;
  lines: number;
}

// CJK / fullwidth Unicode ranges that count as visual width 2.
// Spec ranges documented in the PR brief.
const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, punctuation
  [0x3040, 0xa4cf], // Hiragana, Katakana, CJK Unified, Yi
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe30, 0xfe4f], // CJK Compatibility Forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6], // Fullwidth signs
];

function isCjkCodePoint(cp: number): boolean {
  for (const range of CJK_RANGES) {
    if (cp >= range[0] && cp <= range[1]) {
      return true;
    }
  }
  return false;
}

/**
 * Does `text` contain any CJK / fullwidth codepoint? Callers use this to
 * apply a wider bbox buffer when Excalidraw's runtime font fallback (the
 * default Excalifont / Virgil / Cascadia families ship no Hangul / Kana
 * glyphs, so the renderer falls back to the platform font) measures wider
 * than our static `avgCharWidth` estimate.
 */
export function containsCjk(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isCjkCodePoint(cp)) return true;
  }
  return false;
}

/**
 * Compute visual width units for a line: CJK/fullwidth counts as 2,
 * everything else as 1. Iteration is codepoint-aware so surrogate pairs
 * don't double-count.
 */
function visualLength(line: string): number {
  let units = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0) ?? 0;
    units += isCjkCodePoint(cp) ? 2 : 1;
  }
  return units;
}

/**
 * Measure a (possibly multi-line) string against a static font metric table.
 * Height = lineCount * lineHeight * fontSize. Width = widest line in visual
 * units × avgCharWidth × fontSize. Results are rounded up to whole pixels.
 */
export function measureText(params: MeasureParams): TextMetrics {
  const metrics = getFontMetrics(params.fontFamily);
  const lineHeight = params.lineHeight ?? metrics.lineHeight;

  const lines = params.text.split('\n');
  let maxUnits = 0;
  for (const line of lines) {
    const units = visualLength(line);
    if (units > maxUnits) maxUnits = units;
  }

  const width = Math.ceil(maxUnits * metrics.avgCharWidth * params.fontSize);
  const height = Math.ceil(lines.length * lineHeight * params.fontSize);
  return { width, height, lines: lines.length };
}

/**
 * Convenience accessor for a font's default line height multiplier — matches
 * Excalidraw's `lineHeight` (unitless) brand.
 */
export function getLineHeight(fontFamily: FontFamilyId): number {
  return getFontMetrics(fontFamily).lineHeight;
}
