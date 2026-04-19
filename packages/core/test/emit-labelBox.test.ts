// LabelBox geometry regression tests.
//
// Excalidraw 0.17.x renders container-bound text only when:
//   1. `containerId` points to the shape's id
//   2. The shape lists the text in `boundElements`
//   3. `baseline` is a positive integer (required field; missing -> NaN
//      -> text falls below the clip rect and disappears)
//
// The text element's x/y/width/height should fit *inside* the container
// (not exceed the container bbox). Text bboxes that exactly match the
// container bbox trigger Excalidraw's `refreshTextDimensions` to clamp
// the glyph run to zero on first paint — the user-visible B1 bug.

import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile/index.js';
import { sketchyTheme } from '../src/theme.js';
import type {
  LabelBox,
  PrimitiveId,
  Scene,
} from '../src/primitives.js';
import type {
  ExcalidrawRectangleElement,
  ExcalidrawTextElement,
} from '../src/types/excalidraw.js';

function makeScene(primitives: LabelBox[]): Scene {
  return {
    primitives: new Map(primitives.map((p) => [p.id, p])),
    theme: sketchyTheme,
  };
}

describe('emitLabelBox — container-bound text geometry (B1)', () => {
  it('text element sits inside the container bbox with baseline set', () => {
    const p: LabelBox = {
      kind: 'labelBox',
      id: 'n1' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 100],
      text: 'Hello',
    };
    const result = compile(makeScene([p]));
    const shape = result.elements.find(
      (e): e is ExcalidrawRectangleElement => e.type === 'rectangle',
    )!;
    const text = result.elements.find(
      (e): e is ExcalidrawTextElement => e.type === 'text',
    )!;

    expect(text.containerId).toBe(shape.id);
    // Centred horizontally.
    expect(text.x + text.width / 2).toBeCloseTo(shape.x + shape.width / 2, 1);
    // Fits inside.
    expect(text.width).toBeLessThanOrEqual(shape.width);
    expect(text.height).toBeLessThanOrEqual(shape.height);
    // Excalidraw 0.17.x requires a real baseline value.
    expect(text.baseline).toBeGreaterThan(0);
  });

  it('preserves originalText verbatim and emits wrapped glyph run', () => {
    const p: LabelBox = {
      kind: 'labelBox',
      id: 'n1' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 0],
      text: 'Hello World',
    };
    const result = compile(makeScene([p]));
    const text = result.elements.find(
      (e): e is ExcalidrawTextElement => e.type === 'text',
    )!;

    expect(text.originalText).toBe('Hello World');
    expect(text.text.length).toBeGreaterThan(0);
    expect(text.text).toMatch(/Hello/);
  });

  it('fixed-size box centres text within the container', () => {
    const p: LabelBox = {
      kind: 'labelBox',
      id: 'n1' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 0],
      fit: 'fixed',
      size: [120, 80],
      text: 'multi line label that probably wraps',
    };
    const result = compile(makeScene([p]));
    const shape = result.elements.find(
      (e): e is ExcalidrawRectangleElement => e.type === 'rectangle',
    )!;
    const text = result.elements.find(
      (e): e is ExcalidrawTextElement => e.type === 'text',
    )!;

    expect(shape.width).toBe(120);
    expect(shape.height).toBe(80);
    // Text fits inside.
    expect(text.width).toBeLessThanOrEqual(120);
    expect(text.height).toBeLessThanOrEqual(80);
    // Centred (to within rounding).
    expect(text.x + text.width / 2).toBeCloseTo(shape.x + shape.width / 2, 1);
    expect(text.y + text.height / 2).toBeCloseTo(shape.y + shape.height / 2, 1);
  });

  it('shape still registers the text in boundElements so Excalidraw pairs them', () => {
    const p: LabelBox = {
      kind: 'labelBox',
      id: 'n1' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 0],
      text: 'X',
    };
    const result = compile(makeScene([p]));
    const shape = result.elements.find(
      (e): e is ExcalidrawRectangleElement => e.type === 'rectangle',
    )!;
    const text = result.elements.find(
      (e): e is ExcalidrawTextElement => e.type === 'text',
    )!;
    expect(shape.boundElements).toContainEqual({ type: 'text', id: text.id });
  });
});
