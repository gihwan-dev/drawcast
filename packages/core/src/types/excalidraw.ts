// Structural typings for Excalidraw JSON elements. This is OUR typing of
// someone else's format — kept deliberately structural so compile emitters
// can produce plain objects without importing Excalidraw's runtime.
// See docs/08-excalidraw-reference.md for every field's canonical default.

import type { Arrowhead, FillStyle, StrokeStyle, Roughness } from '../theme.js';
import type { Radians } from '../primitives.js';

// Re-export Arrowhead so callers can `import type { Arrowhead }` from here,
// which keeps compile-facing code from reaching into theme.ts directly.
export type { Arrowhead };

/** Opaque file id — in practice SHA-1 of the file bytes. */
export type FileId = string & { readonly __brand: 'FileId' };

/** Local point relative to a linear element's (x, y) origin. */
export type LocalPoint = readonly [x: number, y: number];

/** Supported roundness modes. `null` is sharp. */
export type Roundness = { type: 1 | 2 | 3; value?: number } | null;

/** Entry in an element's `boundElements` array. */
export interface BoundElement {
  type: 'text' | 'arrow';
  id: string;
}

/** Binding used by arrows. Excalidraw 0.17.x only understands this shape;
 * FixedPointBinding (with `fixedPoint`) lands in 0.18+. */
export interface PointBinding {
  elementId: string;
  focus: number;
  gap: number;
}

/** @deprecated 0.17.x does not recognise `fixedPoint`; use PointBinding. */
export interface FixedPointBinding extends PointBinding {
  fixedPoint: readonly [number, number];
}

/** FractionalIndex — left as string (or null for auto-fill by restore). */
export type FractionalIndex = string | null;

// -----------------------------------------------------------------------------
// Common base fields
// -----------------------------------------------------------------------------

/**
 * Shared fields on every Excalidraw element. Keep this in sync with
 * `BaseElementFields` in utils/baseElementFields.ts (they are structurally
 * equivalent; this one is the `type` side of that factory).
 */
export interface ExcalidrawElementBase {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: Radians;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: Roughness;
  opacity: number;
  groupIds: string[];
  frameId: string | null;
  roundness: Roundness;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  boundElements: BoundElement[];
  updated: number;
  link: string | null;
  locked: boolean;
  // `undefined` must be permitted so the baseElementFields() factory — which
  // always writes the slot — type-checks under exactOptionalPropertyTypes.
  customData: Record<string, unknown> | undefined;
  index: FractionalIndex;
}

// -----------------------------------------------------------------------------
// Generic shapes
// -----------------------------------------------------------------------------

export interface ExcalidrawRectangleElement extends ExcalidrawElementBase {
  type: 'rectangle';
}

export interface ExcalidrawEllipseElement extends ExcalidrawElementBase {
  type: 'ellipse';
}

export interface ExcalidrawDiamondElement extends ExcalidrawElementBase {
  type: 'diamond';
}

// -----------------------------------------------------------------------------
// Text
// -----------------------------------------------------------------------------

export interface ExcalidrawTextElement extends ExcalidrawElementBase {
  type: 'text';
  text: string;
  originalText: string;
  fontSize: number;
  fontFamily: 1 | 2 | 3 | 5 | 6 | 7 | 8 | 9;
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  containerId: string | null;
  lineHeight: number;
  // `baseline` is required by Excalidraw 0.17.x's restore(); omitting it
  // leaves the text invisible because restore substitutes NaN for the
  // glyph-vertical offset. 0.18+ derives it from font metrics, but the
  // pinned version here does not.
  baseline: number;
}

// -----------------------------------------------------------------------------
// Linear elements
// -----------------------------------------------------------------------------

export interface ExcalidrawArrowElement extends ExcalidrawElementBase {
  type: 'arrow';
  points: LocalPoint[];
  lastCommittedPoint: LocalPoint | null;
  startBinding: PointBinding | null;
  endBinding: PointBinding | null;
  startArrowhead: Arrowhead | null;
  endArrowhead: Arrowhead | null;
}

export interface ExcalidrawLineElement extends ExcalidrawElementBase {
  type: 'line';
  points: LocalPoint[];
  lastCommittedPoint: LocalPoint | null;
  startArrowhead: Arrowhead | null;
  endArrowhead: Arrowhead | null;
}

// -----------------------------------------------------------------------------
// Freedraw
// -----------------------------------------------------------------------------

export interface ExcalidrawFreedrawElement extends ExcalidrawElementBase {
  type: 'freedraw';
  points: LocalPoint[];
  pressures: number[];
  simulatePressure: boolean;
  lastCommittedPoint: LocalPoint | null;
}

// -----------------------------------------------------------------------------
// Image
// -----------------------------------------------------------------------------

export interface ExcalidrawImageElement extends ExcalidrawElementBase {
  type: 'image';
  fileId: FileId | null;
  status: 'pending' | 'saved' | 'error';
  scale: readonly [number, number];
  crop:
    | {
        x: number;
        y: number;
        width: number;
        height: number;
        naturalWidth: number;
        naturalHeight: number;
      }
    | null;
}

// -----------------------------------------------------------------------------
// Frame / MagicFrame
// -----------------------------------------------------------------------------

export interface ExcalidrawFrameElement extends ExcalidrawElementBase {
  type: 'frame';
  name: string | null;
}

export interface ExcalidrawMagicFrameElement extends ExcalidrawElementBase {
  type: 'magicframe';
  name: string | null;
}

// -----------------------------------------------------------------------------
// Embeddable / iframe
// -----------------------------------------------------------------------------

export interface ExcalidrawIframeElement extends ExcalidrawElementBase {
  type: 'iframe';
  validated?: boolean;
}

/**
 * Alias: embeddable is represented as an iframe-shaped element in Excalidraw's
 * on-disk format today. See docs/08-excalidraw-reference.md (embeddable/iframe).
 */
export type ExcalidrawEmbeddableElement = Omit<ExcalidrawIframeElement, 'type'> & {
  type: 'embeddable';
};

// -----------------------------------------------------------------------------
// Discriminated union of every element kind we can emit
// -----------------------------------------------------------------------------

export type ExcalidrawElement =
  | ExcalidrawRectangleElement
  | ExcalidrawEllipseElement
  | ExcalidrawDiamondElement
  | ExcalidrawTextElement
  | ExcalidrawArrowElement
  | ExcalidrawLineElement
  | ExcalidrawFreedrawElement
  | ExcalidrawImageElement
  | ExcalidrawFrameElement
  | ExcalidrawMagicFrameElement
  | ExcalidrawIframeElement
  | ExcalidrawEmbeddableElement;

// -----------------------------------------------------------------------------
// Binary files map
// -----------------------------------------------------------------------------

export interface ExcalidrawFileEntry {
  id: FileId;
  mimeType: string;
  dataURL: string;
  created: number;
  lastRetrieved: number;
}

export type BinaryFiles = Record<FileId, ExcalidrawFileEntry>;
