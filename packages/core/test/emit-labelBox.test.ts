// LabelBox geometry regression tests.
//
// Excalidraw's container-bound text renders correctly only when the text
// element shares the container's bounding box (x, y, width, height); the
// renderer itself positions the glyph run according to textAlign /
// verticalAlign. Emitting the text with the measured glyph bbox instead of
// the container bbox causes the label to either clip or disappear — which
// is the user-visible B1 bug this file guards against.

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
  it('text element shares the container bbox so Excalidraw renders it', () => {
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
    expect(text.x).toBe(shape.x);
    expect(text.y).toBe(shape.y);
    expect(text.width).toBe(shape.width);
    expect(text.height).toBe(shape.height);
    expect(text.autoResize).toBe(false);
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

  it('fixed-size box still places text at the container bbox', () => {
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
    expect(text.x).toBe(shape.x);
    expect(text.y).toBe(shape.y);
    expect(text.width).toBe(120);
    expect(text.height).toBe(80);
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
