// buildGraphModel must feed ELK node dimensions that match what the emit
// pass will ultimately render. Without this, auto-fit LabelBoxes lose
// their measured size on the way to ELK, which falls back to a 160x60
// default — too small for multi-line or CJK labels — and the emit pass
// then clips the text against the laid-out box. See eval regression
// flow-login-01 (2026-04-21) where 5-line Korean labels overflowed.

import { describe, expect, it } from 'vitest';
import { buildGraphModel } from '../src/layout/buildGraphModel.js';
import { measureText } from '../src/measure.js';
import { sketchyTheme } from '../src/theme.js';
import type {
  LabelBox,
  Primitive,
  PrimitiveId,
  Scene,
} from '../src/primitives.js';

function sceneOf(primitives: Primitive[]): Scene {
  return {
    primitives: new Map(primitives.map((p) => [p.id, p])),
    theme: sketchyTheme,
  };
}

function autoBox(id: string, text: string): LabelBox {
  return {
    kind: 'labelBox',
    id: id as PrimitiveId,
    shape: 'rectangle',
    text,
  };
}

describe('buildGraphModel auto-fit sizing', () => {
  it('sizes LabelBoxes without explicit size to match measured text + padding', () => {
    const text = '인증 실패 메시지\n(잘못된 정보)';
    const graph = buildGraphModel(sceneOf([autoBox('a', text)]));
    expect(graph).not.toBeNull();
    const node = graph!.children[0]!;
    const metrics = measureText({
      text,
      fontSize: sketchyTheme.defaultFontSize,
      fontFamily: sketchyTheme.defaultFontFamily,
    });
    expect(node.width).toBe(metrics.width + 40);
    expect(node.height).toBe(metrics.height + 40);
  });

  it('keeps explicit size when fit is fixed', () => {
    const pinned: LabelBox = {
      kind: 'labelBox',
      id: 'p' as PrimitiveId,
      shape: 'rectangle',
      text: 'whatever',
      fit: 'fixed',
      size: [300, 120],
    };
    const graph = buildGraphModel(sceneOf([pinned]));
    const node = graph!.children[0]!;
    expect(node.width).toBe(300);
    expect(node.height).toBe(120);
  });

  it('falls back to minimum size for empty text', () => {
    const graph = buildGraphModel(sceneOf([autoBox('a', '')]));
    const node = graph!.children[0]!;
    expect(node.width).toBe(80);
    expect(node.height).toBe(40);
  });

  it('sizes multi-line labels taller than single-line', () => {
    const short = buildGraphModel(sceneOf([autoBox('a', '짧은 라벨')]));
    const tall = buildGraphModel(sceneOf([autoBox('b', '세\n줄\n라벨')]));
    const shortH = short!.children[0]!.height ?? 0;
    const tallH = tall!.children[0]!.height ?? 0;
    expect(tallH).toBeGreaterThan(shortH);
  });
});
