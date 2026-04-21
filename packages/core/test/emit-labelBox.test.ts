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

describe('emitLabelBox — optional `at` (Phase 2 hybrid contract)', () => {
  it('renders at scene origin when `at` is omitted and the sync compile is used', () => {
    // Sync compile path with no layout engine: missing `at` must not
    // crash and must not emit NaN coordinates. Origin fallback is the
    // explicit signal the caller skipped the layout pass.
    const box: LabelBox = {
      kind: 'labelBox',
      id: 'orphan' as PrimitiveId,
      shape: 'rectangle',
      text: 'hi',
    };
    const result = compile(makeScene([box]));
    const rect = result.elements.find(
      (el): el is ExcalidrawRectangleElement => el.type === 'rectangle',
    );
    expect(rect).toBeDefined();
    expect(Number.isFinite(rect!.x)).toBe(true);
    expect(Number.isFinite(rect!.y)).toBe(true);
    // Shape centre sits on (0, 0) so the rectangle itself lives at
    // half-size offsets from the origin.
    expect(rect!.x + rect!.width / 2).toBe(0);
    expect(rect!.y + rect!.height / 2).toBe(0);
  });
});

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

    // Width stays pinned to the fit:'fixed' request; height can grow so
    // the wrapped glyph run is contained (see emit/labelBox.ts comment).
    expect(shape.width).toBe(120);
    expect(shape.height).toBeGreaterThanOrEqual(80);
    // Text fits inside.
    expect(text.width).toBeLessThanOrEqual(shape.width);
    expect(text.height).toBeLessThanOrEqual(shape.height);
    // Centred (to within rounding).
    expect(text.x + text.width / 2).toBeCloseTo(shape.x + shape.width / 2, 1);
    expect(text.y + text.height / 2).toBeCloseTo(shape.y + shape.height / 2, 1);
  });

  it('expands fixed-height box so wrapped text does not overflow', () => {
    // Regression: arch-cdn-03 eval showed "Main DB (Primary)\nPostgreSQL"
    // wrapping into 3 lines inside a fit:'fixed' [200, 65] box, so the
    // "PostgreSQL" line spilled below the shape onto a nearby edge label.
    const p: LabelBox = {
      kind: 'labelBox',
      id: 'main_db' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 0],
      fit: 'fixed',
      size: [200, 65],
      text: 'Main DB (Primary)\nPostgreSQL',
    };
    const result = compile(makeScene([p]));
    const shape = result.elements.find(
      (e): e is ExcalidrawRectangleElement => e.type === 'rectangle',
    )!;
    const text = result.elements.find(
      (e): e is ExcalidrawTextElement => e.type === 'text',
    )!;
    // The container must be tall enough that the wrapped text fits inside.
    expect(shape.height).toBeGreaterThan(65);
    expect(text.height).toBeLessThanOrEqual(shape.height);
    // The text bottom stays within the shape bottom.
    expect(text.y + text.height).toBeLessThanOrEqual(shape.y + shape.height + 1);
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

describe('emitLabelBox — text contrast fallback', () => {
  // Regression: mind-react-01 eval surfaced Claude-authored nodes using a
  // darker-shade stroke as the bound text color (e.g. bg=#2f9e44 with
  // stroke=#2b8a3e). VLM rubrics flagged readability=2 with "텍스트 대비가
  // 낮아" across the diagram's central branches. The emitter must drop
  // the authored stroke whenever its contrast against the fill falls
  // below WCAG 4.5:1 and fall back to #1e1e1e or #ffffff.
  it('replaces low-contrast tinted stroke with the dark fallback on light fills', () => {
    const p: LabelBox = {
      kind: 'labelBox',
      id: 'n1' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 0],
      text: 'low contrast',
      style: {
        backgroundColor: '#fef3c7',
        strokeColor: '#fcd34d',
      },
    };
    const result = compile(makeScene([p]));
    const text = result.elements.find(
      (e): e is ExcalidrawTextElement => e.type === 'text',
    )!;
    expect(text.strokeColor).toBe('#1e1e1e');
  });

  it('uses white text on saturated mid-dark fills where dark would still read low', () => {
    const p: LabelBox = {
      kind: 'labelBox',
      id: 'n1' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 0],
      text: 'low contrast',
      style: {
        backgroundColor: '#2f9e44',
        strokeColor: '#2b8a3e',
      },
    };
    const result = compile(makeScene([p]));
    const text = result.elements.find(
      (e): e is ExcalidrawTextElement => e.type === 'text',
    )!;
    expect(text.strokeColor).toBe('#ffffff');
  });

  it('keeps the authored stroke when contrast already clears the threshold', () => {
    const p: LabelBox = {
      kind: 'labelBox',
      id: 'n1' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 0],
      text: 'good contrast',
      style: {
        backgroundColor: '#ffffff',
        strokeColor: '#1e1e1e',
      },
    };
    const result = compile(makeScene([p]));
    const text = result.elements.find(
      (e): e is ExcalidrawTextElement => e.type === 'text',
    )!;
    expect(text.strokeColor).toBe('#1e1e1e');
  });
});
