// Compliance runner tests — one per invariant C1..C10, plus an integration
// test that proves a vanilla two-box compile passes every check.

import { describe, expect, it } from 'vitest';
import { runCompliance } from '../src/testing/compliance.js';
import type { ComplianceCode } from '../src/testing/compliance.js';
import { compile } from '../src/compile/index.js';
import { sketchyTheme } from '../src/theme.js';
import { baseElementFields } from '../src/utils/baseElementFields.js';
import type {
  BinaryFiles,
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawImageElement,
  ExcalidrawRectangleElement,
  ExcalidrawTextElement,
  FileId,
} from '../src/types/excalidraw.js';
import type {
  Connector,
  LabelBox,
  PrimitiveId,
  Radians,
  Scene,
} from '../src/primitives.js';

function rect(overrides: Partial<ExcalidrawRectangleElement> = {}): ExcalidrawRectangleElement {
  const base = baseElementFields({ id: overrides.id ?? 'r1' });
  return {
    ...base,
    type: 'rectangle',
    angle: base.angle as Radians,
    ...overrides,
  };
}

function text(overrides: Partial<ExcalidrawTextElement> = {}): ExcalidrawTextElement {
  const base = baseElementFields({ id: overrides.id ?? 't1' });
  return {
    ...base,
    type: 'text',
    angle: base.angle as Radians,
    text: overrides.text ?? '',
    originalText: overrides.originalText ?? overrides.text ?? '',
    fontSize: overrides.fontSize ?? 20,
    fontFamily: overrides.fontFamily ?? 5,
    textAlign: overrides.textAlign ?? 'left',
    verticalAlign: overrides.verticalAlign ?? 'top',
    containerId: overrides.containerId ?? null,
    lineHeight: overrides.lineHeight ?? 1.25,
    baseline: overrides.baseline ?? 16,
    ...overrides,
  };
}

function arrow(overrides: Partial<ExcalidrawArrowElement> = {}): ExcalidrawArrowElement {
  const base = baseElementFields({ id: overrides.id ?? 'a1' });
  return {
    ...base,
    type: 'arrow',
    angle: base.angle as Radians,
    points: overrides.points ?? [[0, 0], [10, 0]],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: 'arrow',
    ...overrides,
  };
}

function image(overrides: Partial<ExcalidrawImageElement> = {}): ExcalidrawImageElement {
  const base = baseElementFields({ id: overrides.id ?? 'img1' });
  return {
    ...base,
    type: 'image',
    angle: base.angle as Radians,
    fileId: overrides.fileId ?? null,
    status: overrides.status ?? 'pending',
    scale: overrides.scale ?? [1, 1],
    crop: overrides.crop ?? null,
    ...overrides,
  };
}

function codes(issues: ReturnType<typeof runCompliance>['issues']): ComplianceCode[] {
  return issues.map((i) => i.code);
}

describe('C1 — base field presence', () => {
  it('reports missing seed on an incomplete element', () => {
    const el = rect() as ExcalidrawElement;
    // Tear off a required field.
    delete (el as unknown as Record<string, unknown>).seed;
    const report = runCompliance([el], {});
    expect(report.passed).toBe(false);
    expect(codes(report.issues)).toContain('C1');
    expect(report.issues.some((i) => i.message.includes("'seed'"))).toBe(true);
  });
});

describe('C2 — seed / versionNonce uniqueness', () => {
  it('flags two elements sharing the same seed', () => {
    const a = rect({ id: 'a', seed: 42 });
    const b = rect({ id: 'b', seed: 42, versionNonce: 99 });
    const report = runCompliance([a, b], {});
    expect(report.passed).toBe(false);
    const c2 = report.issues.filter((i) => i.code === 'C2');
    expect(c2.some((i) => i.message.includes('duplicate seed 42'))).toBe(true);
  });
});

describe('C3 — linear element points[0] normalization', () => {
  it('flags an arrow whose first point is not [0, 0]', () => {
    const a = arrow({ id: 'a', points: [[5, 5], [20, 20]] });
    const report = runCompliance([a], {});
    expect(report.passed).toBe(false);
    const c3 = report.issues.filter((i) => i.code === 'C3');
    expect(c3).toHaveLength(1);
    expect(c3[0]!.message).toContain('points[0] must be [0, 0]');
  });
});

describe('C4 — text/container binding', () => {
  it('flags a text whose containerId does not exist', () => {
    const t = text({ id: 't1', containerId: 'ghost' });
    const report = runCompliance([t], {});
    expect(report.passed).toBe(false);
    expect(codes(report.issues)).toContain('C4');
  });
});

describe('C5 — arrow binding bidirectionality', () => {
  it('flags an arrow whose target lacks a boundElements entry', () => {
    const target = rect({ id: 'r1', boundElements: [] });
    const a = arrow({
      id: 'a1',
      startBinding: { elementId: 'r1', focus: 0, gap: 1 },
    });
    const report = runCompliance([target, a], {});
    expect(report.passed).toBe(false);
    expect(codes(report.issues)).toContain('C5');
  });
});

describe('C6 — image fileId must resolve', () => {
  it('flags a saved image whose fileId is missing from files', () => {
    const img = image({
      id: 'img1',
      fileId: 'missing' as FileId,
      status: 'saved',
    });
    const report = runCompliance([img], {} as BinaryFiles);
    expect(report.passed).toBe(false);
    expect(codes(report.issues)).toContain('C6');
  });

  it('allows a pending image with null fileId', () => {
    const img = image({ id: 'img1', fileId: null, status: 'pending' });
    const report = runCompliance([img], {});
    // C6 specifically should not complain (other checks are unrelated).
    expect(report.issues.filter((i) => i.code === 'C6')).toEqual([]);
  });
});

describe('C7 — frameId must point to an existing frame', () => {
  it('flags a frameId that is not a frame element', () => {
    const r = rect({ id: 'r1', frameId: 'no-such-frame' });
    const report = runCompliance([r], {});
    expect(report.passed).toBe(false);
    expect(codes(report.issues)).toContain('C7');
  });
});

describe('C8 — angle must be radians', () => {
  it('flags an angle that looks like degrees', () => {
    const r = rect({ id: 'r1', angle: 180 as Radians });
    const report = runCompliance([r], {});
    expect(report.passed).toBe(false);
    expect(codes(report.issues)).toContain('C8');
  });
});

describe('C9 — opacity range', () => {
  it('flags opacity outside [0, 100]', () => {
    const r = rect({ id: 'r1', opacity: 150 });
    const report = runCompliance([r], {});
    expect(report.passed).toBe(false);
    expect(codes(report.issues)).toContain('C9');
  });
});

describe('C10 — elbow arrow binding (reserved for 0.18+)', () => {
  // Excalidraw 0.17.x has no elbow-arrow concept. The check currently
  // no-ops; once we bump the pinned version it should reactivate. The
  // placeholder below pins the contract so regressions are visible.
  it('no-ops on 0.17.x schema — legal to bind without fixedPoint', () => {
    const target = rect({
      id: 'r1',
      boundElements: [{ type: 'arrow', id: 'a1' }],
    });
    const a = arrow({
      id: 'a1',
      startBinding: { elementId: 'r1', focus: 0, gap: 1 },
    });
    const report = runCompliance([target, a], {});
    const c10 = report.issues.filter((i) => i.code === 'C10');
    expect(c10).toEqual([]);
  });
});

describe('integration — compile → runCompliance', () => {
  it('a simple two-box connector scene passes every compliance check', () => {
    const boxA: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [100, 100],
      text: 'A',
    };
    const boxB: LabelBox = {
      kind: 'labelBox',
      id: 'b' as PrimitiveId,
      shape: 'rectangle',
      at: [400, 100],
      text: 'B',
    };
    const edge: Connector = {
      kind: 'connector',
      id: 'c' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: 'b' as PrimitiveId,
    };
    const scene: Scene = {
      primitives: new Map([
        [boxA.id, boxA],
        [boxB.id, boxB],
        [edge.id, edge],
      ]),
      theme: sketchyTheme,
    };
    const result = compile(scene);
    const report = runCompliance(result.elements, result.files);
    expect(report.issues).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.checksPassed).toBe(10);
    expect(report.checksFailed).toBe(0);
  });
});
