// Factory for the 25+ common fields shared by every Excalidraw element.
// See docs/08-excalidraw-reference.md (lines 18-48) and
// docs/03-compile-pipeline.md (around lines 640-668).

import { newElementId, randomInteger } from './id.js';

/**
 * Common base fields for every Excalidraw element. `type` is required but
 * intentionally NOT defaulted here — each emitter supplies its own literal.
 */
export interface BaseElementFields {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: 'hachure' | 'cross-hatch' | 'solid' | 'zigzag';
  strokeWidth: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  roughness: 0 | 1 | 2;
  opacity: number;
  groupIds: string[];
  frameId: string | null;
  roundness: { type: 1 | 2 | 3; value?: number } | null;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  boundElements: Array<{ type: 'text' | 'arrow'; id: string }>;
  updated: number;
  link: string | null;
  locked: boolean;
  customData: Record<string, unknown> | undefined;
  index: string | null;
}

/**
 * Build a fresh set of base fields with sensible Excalidraw defaults.
 * `type` must be supplied via `overrides` since it is element-specific.
 */
export function baseElementFields(
  overrides?: Partial<BaseElementFields>,
): BaseElementFields {
  const base: BaseElementFields = {
    id: newElementId(),
    // Placeholder; emitters always override with their literal type.
    type: '',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: randomInteger(),
    version: 1,
    versionNonce: randomInteger(),
    isDeleted: false,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
    customData: undefined,
    index: null,
  };
  return overrides ? { ...base, ...overrides } : base;
}
