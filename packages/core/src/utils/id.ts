// ID and integer helpers. Shared by compile and other packages.
// See docs/03-compile-pipeline.md (lines 670-685).

import { customAlphabet } from 'nanoid';
import type { PrimitiveId } from '../primitives.js';

// Excalidraw convention: 21 chars from alphanumeric alphabet (no URL-unsafe chars).
const ELEMENT_ID_ALPHABET =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const elementIdGenerator = customAlphabet(ELEMENT_ID_ALPHABET, 21);

/**
 * Generate a 21-character nanoid using the Excalidraw-style alphanumeric alphabet.
 * Used for Excalidraw `id` fields (elements, group ids, etc.).
 */
export function newElementId(): string {
  return elementIdGenerator();
}

/**
 * Generate a 21-character nanoid branded as a `PrimitiveId` for L2 primitives.
 */
export function newPrimitiveId(): PrimitiveId {
  return elementIdGenerator() as PrimitiveId;
}

/**
 * Random 31-bit non-negative integer suitable for `seed` and `versionNonce`.
 * 2^31 = 0x80000000; values are in [0, 2^31).
 */
export function randomInteger(): number {
  return Math.floor(Math.random() * 0x80000000);
}
