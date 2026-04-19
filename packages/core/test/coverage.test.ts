// Coverage-emitter tests for PR #6: Line, Freedraw, Image, Embed, plus the
// shared normalizePoints unit test. Regression coverage for the Connector
// refactor lives in `compile.test.ts`.

import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile/index.js';
import { normalizePoints } from '../src/emit/shared/points.js';
import { sketchyTheme } from '../src/theme.js';
import type {
  Embed,
  Freedraw,
  Image,
  Line,
  Point,
  Primitive,
  PrimitiveId,
  Scene,
} from '../src/primitives.js';
import type {
  ExcalidrawElement,
  ExcalidrawFreedrawElement,
  ExcalidrawIframeElement,
  ExcalidrawImageElement,
  ExcalidrawLineElement,
} from '../src/types/excalidraw.js';

function makeScene(primitives: Primitive[]): Scene {
  return {
    primitives: new Map(primitives.map((p) => [p.id, p])),
    theme: sketchyTheme,
  };
}

function find<T extends ExcalidrawElement>(
  elements: ExcalidrawElement[],
  pred: (el: ExcalidrawElement) => el is T,
): T {
  const found = elements.find(pred);
  if (!found) throw new Error('element not found');
  return found;
}

describe('normalizePoints', () => {
  it('translates to local origin, computes bbox', () => {
    const input: Point[] = [
      [10, 20],
      [30, 40],
      [50, 60],
    ];
    const out = normalizePoints(input);
    expect(out.x).toBe(10);
    expect(out.y).toBe(20);
    expect(out.points).toEqual([
      [0, 0],
      [20, 20],
      [40, 40],
    ]);
    expect(out.width).toBe(40);
    expect(out.height).toBe(40);
  });

  it('returns zero box for empty input', () => {
    expect(normalizePoints([])).toEqual({
      points: [],
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});

describe('compile — Line', () => {
  it('emits a single line element with normalised points (P3)', () => {
    const p: Line = {
      kind: 'line',
      id: 'l1' as PrimitiveId,
      at: [100, 200],
      points: [
        [0, 0],
        [50, 0],
        [50, 30],
      ],
    };
    const result = compile(makeScene([p]));
    expect(result.warnings).toEqual([]);
    expect(result.elements).toHaveLength(1);
    const line = find(
      result.elements,
      (el): el is ExcalidrawLineElement => el.type === 'line',
    );
    expect(line.points[0]).toEqual([0, 0]);
    expect(line.points).toHaveLength(3);
    expect(line.x).toBe(100);
    expect(line.y).toBe(200);
    expect(line.width).toBe(50);
    expect(line.height).toBe(30);
  });

  it('polygon:true closes the polyline (first === last)', () => {
    const p: Line = {
      kind: 'line',
      id: 'tri' as PrimitiveId,
      at: [0, 0],
      points: [
        [0, 0],
        [40, 0],
        [20, 30],
      ],
      polygon: true,
    };
    const result = compile(makeScene([p]));
    const line = find(
      result.elements,
      (el): el is ExcalidrawLineElement => el.type === 'line',
    );
    // 0.17.x has no `polygon` field on line elements; the emitter
    // simulates closure by ensuring the last point equals the first.
    expect(line.points[0]).toEqual(line.points[line.points.length - 1]);
  });
});

describe('compile — Freedraw', () => {
  it('preserves pressures and disables simulatePressure when given', () => {
    const p: Freedraw = {
      kind: 'freedraw',
      id: 'fd' as PrimitiveId,
      at: [10, 10],
      points: [
        [0, 0],
        [5, 5],
        [10, 10],
      ],
      pressures: [0.2, 0.5, 0.9],
    };
    const result = compile(makeScene([p]));
    expect(result.warnings).toEqual([]);
    const fd = find(
      result.elements,
      (el): el is ExcalidrawFreedrawElement => el.type === 'freedraw',
    );
    expect(fd.pressures).toEqual([0.2, 0.5, 0.9]);
    expect(fd.simulatePressure).toBe(false);
    expect(fd.points[0]).toEqual([0, 0]);
    expect(fd.x).toBe(10);
    expect(fd.y).toBe(10);
  });

  it('defaults pressures:[] and simulatePressure:true when pressures absent', () => {
    const p: Freedraw = {
      kind: 'freedraw',
      id: 'fd2' as PrimitiveId,
      at: [0, 0],
      points: [
        [0, 0],
        [20, 20],
      ],
    };
    const result = compile(makeScene([p]));
    const fd = find(
      result.elements,
      (el): el is ExcalidrawFreedrawElement => el.type === 'freedraw',
    );
    expect(fd.pressures).toEqual([]);
    expect(fd.simulatePressure).toBe(true);
  });
});

describe('compile — Image', () => {
  it('registers dataURL source in ctx.files with status saved', () => {
    const p: Image = {
      kind: 'image',
      id: 'img1' as PrimitiveId,
      at: [100, 100],
      size: [80, 60],
      source: {
        kind: 'data',
        dataURL: 'data:image/png;base64,iVBORw0KGgo=',
        mimeType: 'image/png',
      },
    };
    const result = compile(makeScene([p]));
    expect(result.warnings).toEqual([]);
    const img = find(
      result.elements,
      (el): el is ExcalidrawImageElement => el.type === 'image',
    );
    expect(img.status).toBe('saved');
    expect(img.fileId).toBeTruthy();
    expect(img.width).toBe(80);
    expect(img.height).toBe(60);
    // Centred on p.at.
    expect(img.x).toBe(60);
    expect(img.y).toBe(70);
    const fileIds = Object.keys(result.files);
    expect(fileIds).toHaveLength(1);
    const entry = result.files[img.fileId!];
    expect(entry).toBeDefined();
    expect(entry!.dataURL).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(entry!.mimeType).toBe('image/png');
  });

  it('path source emits placeholder + IMAGE_PATH_PENDING warning', () => {
    const p: Image = {
      kind: 'image',
      id: 'img2' as PrimitiveId,
      at: [0, 0],
      size: [100, 100],
      source: { kind: 'path', path: 'assets/x.png' },
    };
    const result = compile(makeScene([p]));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('IMAGE_PATH_PENDING');
    const img = find(
      result.elements,
      (el): el is ExcalidrawImageElement => el.type === 'image',
    );
    expect(img.status).toBe('pending');
    expect(img.fileId).toBeNull();
    expect(Object.keys(result.files)).toHaveLength(0);
  });
});

describe('compile — Embed', () => {
  it('validated:true emits no warning and sets link', () => {
    const p: Embed = {
      kind: 'embed',
      id: 'e1' as PrimitiveId,
      at: [0, 0],
      size: [400, 300],
      url: 'https://www.youtube.com/embed/abc',
      validated: true,
    };
    const result = compile(makeScene([p]));
    expect(result.warnings).toEqual([]);
    const iframe = find(
      result.elements,
      (el): el is ExcalidrawIframeElement => el.type === 'iframe',
    );
    expect(iframe.link).toBe('https://www.youtube.com/embed/abc');
    expect(iframe.validated).toBe(true);
  });

  it('missing validated pushes EMBED_NOT_VALIDATED warning', () => {
    const p: Embed = {
      kind: 'embed',
      id: 'e2' as PrimitiveId,
      at: [0, 0],
      size: [200, 150],
      url: 'https://example.com/widget',
    };
    const result = compile(makeScene([p]));
    const warning = result.warnings.find((w) => w.code === 'EMBED_NOT_VALIDATED');
    expect(warning).toBeDefined();
    const iframe = find(
      result.elements,
      (el): el is ExcalidrawIframeElement => el.type === 'iframe',
    );
    expect(iframe.link).toBe('https://example.com/widget');
  });
});
