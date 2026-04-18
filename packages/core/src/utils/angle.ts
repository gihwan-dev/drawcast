// Angle conversion helpers. L2 primitives carry angle in degrees;
// Excalidraw elements store radians (branded `Radians` type).
// See docs/03-compile-pipeline.md (lines 687-694).

import type { Radians } from '../primitives.js';

/**
 * Convert degrees to branded `Radians`. Normalizes the input through `% 360`
 * first so callers don't have to pre-normalize.
 */
export function degreesToRadians(deg: number): Radians {
  return (((deg % 360) * Math.PI) / 180) as Radians;
}

/**
 * Convert `Radians` back to degrees.
 */
export function radiansToDegrees(rad: Radians): number {
  return ((rad as number) * 180) / Math.PI;
}
