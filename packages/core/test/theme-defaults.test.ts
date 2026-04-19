// Built-in theme defaults.
//
// `nodes.default` is what every un-styled LabelBox falls back to, so it has
// to look like something — not bare white-on-black. Clean and mono lean on
// soft pastels + rounded corners, sketchy leans on hand-drawn roughness
// with a warm fill. These expectations are intentionally shallow: they
// encode "non-sterile" intent without pinning exact hex codes, so a future
// designer can retune without rewriting the test.

import { describe, expect, it } from 'vitest';
import { cleanTheme, monoTheme, sketchyTheme } from '../src/theme.js';

describe('built-in theme nodes.default (B2)', () => {
  it('clean default uses a tinted fill and rounded corners', () => {
    const def = cleanTheme.nodes.default;
    expect(def.backgroundColor).not.toBe('#ffffff');
    expect(def.backgroundColor).not.toBe('transparent');
    expect(def.roundness).toBeDefined();
    expect(def.roundness).not.toBeNull();
    expect(def.fillStyle).toBe('solid');
  });

  it('sketchy default keeps roughness ≥ 1 and a warm tinted fill', () => {
    const def = sketchyTheme.nodes.default;
    expect(def.roughness).toBeGreaterThanOrEqual(1);
    expect(def.backgroundColor).not.toBe('#ffffff');
    expect(def.backgroundColor).not.toBe('transparent');
  });

  it('mono default uses an off-white fill with rounded corners', () => {
    const def = monoTheme.nodes.default;
    expect(def.backgroundColor).not.toBe('#ffffff');
    expect(def.backgroundColor).not.toBe('transparent');
    expect(def.roundness).toBeDefined();
    expect(def.roundness).not.toBeNull();
  });

  it('edge defaults are not pure black so lines read against the stroke colour', () => {
    expect(cleanTheme.edges.default.strokeColor).not.toBe('#000000');
    expect(sketchyTheme.edges.default.strokeColor).not.toBe('#000000');
    expect(monoTheme.edges.default.strokeColor).not.toBe('#000000');
  });
});
