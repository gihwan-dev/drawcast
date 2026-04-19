// Reconciler for Excalidraw element identity across recompiles.
//
// The browser-side compile pipeline is pure: feed in the L2 primitives + theme,
// get back fresh Excalidraw elements. Fresh as in *literally new* — each call
// to `compile()` allocates new random ids (`newElementId`), seeds, and
// versionNonces. For a read-only renderer that would be fine, but it breaks
// two invariants we care about:
//
//   1. Undo history. Excalidraw's editor keys history entries by element id;
//      if the id churns on every server push, the user loses the ability to
//      undo their own local tweaks.
//   2. Edit detection. PR #20 compares an element's `version` against the
//      previously-seen value to spot user-driven mutations. If the compile
//      pipeline always produces `version: 1`, any real recompile would look
//      identical to "no edit" — which is fine for our purposes, but only if
//      the element id is also stable so we can actually correlate successive
//      snapshots.
//
// The pragmatic fix is a small stateful reconciler: for each fresh element we
// produce, look up the previous element that belongs to the same primitive +
// type. If found, copy over the identity fields (id, seed, version,
// versionNonce) so Excalidraw sees the same element mutating in place. The
// map key is `${primitiveId}::${type}` because compound primitives like
// `LabelBox` emit both a rectangle and a text element — both carry the same
// `drawcastPrimitiveId`, so type is what disambiguates them.
//
// This module is intentionally self-contained so unit tests can drive it
// without pulling in any Excalidraw or React surface area.

import type { BinaryFiles, ExcalidrawElement } from '@drawcast/core';

interface ReconcilerInput {
  /** Elements rendered in the previous frame, or `null` on first compile. */
  prev: readonly ExcalidrawElement[] | null;
  /** Freshly compiled elements we want to push into the canvas. */
  fresh: readonly ExcalidrawElement[];
  /** Files associated with the fresh compile (passed through unchanged). */
  files: BinaryFiles;
  /**
   * Primitive ids whose local state must not be overwritten by the next
   * compile. Elements whose `drawcastPrimitiveId` lies in this set are
   * returned as a copy of their prior version (geometry + identity
   * preserved). Omit / leave empty when nothing is locked.
   */
  lockedIds?: ReadonlySet<string>;
}

export interface ReconcilerOutput {
  elements: ExcalidrawElement[];
  files: BinaryFiles;
}

function extractPrimitiveId(el: ExcalidrawElement): string | null {
  const cd = el.customData;
  if (cd === undefined || cd === null) return null;
  const value = (cd as { drawcastPrimitiveId?: unknown }).drawcastPrimitiveId;
  return typeof value === 'string' ? value : null;
}

function keyFor(primitiveId: string, type: string): string {
  return `${primitiveId}::${type}`;
}

/**
 * Copy identity fields (id, seed, version, versionNonce) from a matched
 * previous element onto a fresh element so Excalidraw sees the same element
 * persist across recompiles.
 *
 * Pure: does not mutate either input; returns a new object.
 */
export function reconcileElements(input: ReconcilerInput): ReconcilerOutput {
  const { prev, fresh, files, lockedIds } = input;
  if (prev === null || prev.length === 0) {
    // No prior frame — nothing to stabilise against. Copy the fresh array
    // so callers never see internal references.
    return { elements: [...fresh], files };
  }

  const prevByKey = new Map<string, ExcalidrawElement>();
  for (const el of prev) {
    const pid = extractPrimitiveId(el);
    if (pid === null) continue;
    prevByKey.set(keyFor(pid, el.type), el);
  }

  const next: ExcalidrawElement[] = fresh.map((el) => {
    const pid = extractPrimitiveId(el);
    if (pid === null) return { ...el };
    const match = prevByKey.get(keyFor(pid, el.type));
    if (match === undefined) return { ...el };
    // Edit-locked primitives: keep the prior element verbatim so a fresh
    // MCP snapshot can't clobber the user's local drag / delete / resize.
    if (lockedIds !== undefined && lockedIds.has(pid)) {
      return { ...match };
    }
    return {
      ...el,
      id: match.id,
      seed: match.seed,
      version: match.version,
      versionNonce: match.versionNonce,
    };
  });

  return { elements: next, files };
}
