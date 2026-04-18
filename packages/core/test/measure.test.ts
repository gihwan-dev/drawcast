import { describe, expect, it } from 'vitest';
import { getLineHeight, measureText } from '../src/measure.js';

// Allow ±5% slop since metrics are approximate (Phase 1 accepts ±10% vs. real).
const TOL = 0.05;
const within = (actual: number, expected: number, tol = TOL): boolean => {
  const delta = Math.abs(actual - expected);
  return delta <= expected * tol + 1; // +1px for ceil rounding noise
};

describe('measureText', () => {
  it('measures a single-line Latin string', () => {
    // Excalifont: avgCharWidth 0.55, lineHeight 1.25
    // "Hello" (5 chars) @ 20px → width ≈ 0.55 * 20 * 5 = 55
    // height ≈ 1.25 * 20 = 25
    const m = measureText({ text: 'Hello', fontSize: 20, fontFamily: 5 });
    expect(m.lines).toBe(1);
    expect(within(m.width, 55)).toBe(true);
    expect(within(m.height, 25)).toBe(true);
  });

  it('handles multi-line text and returns widest line', () => {
    const m = measureText({
      text: 'Hello\nWorld',
      fontSize: 20,
      fontFamily: 5,
    });
    expect(m.lines).toBe(2);
    // Same char count on both lines → width same as single line.
    expect(within(m.width, 55)).toBe(true);
    expect(within(m.height, 50)).toBe(true); // 2 * 1.25 * 20
  });

  it('widest line wins on uneven lines', () => {
    const m = measureText({
      text: 'Hi\nHello World',
      fontSize: 20,
      fontFamily: 5,
    });
    expect(m.lines).toBe(2);
    // "Hello World" = 11 chars → 0.55 * 20 * 11 = 121
    expect(within(m.width, 121)).toBe(true);
  });

  it('treats CJK characters as width 2 (fullwidth)', () => {
    // "안녕하세요" = 5 Hangul syllables → visual units 10
    // width ≈ 0.55 * 20 * 10 = 110
    const m = measureText({ text: '안녕하세요', fontSize: 20, fontFamily: 5 });
    expect(m.lines).toBe(1);
    expect(within(m.width, 110)).toBe(true);
    // Should be roughly 2× "Hello" (same 5 chars, English).
    const h = measureText({ text: 'Hello', fontSize: 20, fontFamily: 5 });
    expect(m.width).toBeGreaterThan(h.width * 1.8);
  });

  it('measures mixed Korean+English as intermediate width', () => {
    // "한글 Eng": 2 CJK (width 4) + 1 space (width 1) + 3 ascii (width 3) = 8 units
    // width ≈ 0.55 * 20 * 8 = 88
    const m = measureText({ text: '한글 Eng', fontSize: 20, fontFamily: 5 });
    const cjkOnly = measureText({
      text: '한글',
      fontSize: 20,
      fontFamily: 5,
    });
    const engOnly = measureText({
      text: 'Eng',
      fontSize: 20,
      fontFamily: 5,
    });
    // Intermediate: wider than either half.
    expect(m.width).toBeGreaterThan(cjkOnly.width);
    expect(m.width).toBeGreaterThan(engOnly.width);
    expect(within(m.width, 88)).toBe(true);
  });

  it('respects lineHeight override', () => {
    const m = measureText({
      text: 'abc',
      fontSize: 20,
      fontFamily: 5,
      lineHeight: 2,
    });
    // 1 line * 2 * 20 = 40
    expect(m.height).toBe(40);
  });

  it('handles empty text without throwing', () => {
    const m = measureText({ text: '', fontSize: 20, fontFamily: 5 });
    expect(m.lines).toBe(1);
    expect(m.width).toBe(0);
    expect(m.height).toBe(25);
  });
});

describe('getLineHeight', () => {
  it('returns 1.25 for Excalifont', () => {
    expect(getLineHeight(5)).toBeCloseTo(1.25, 5);
  });

  it('returns metric values for every FontFamilyId', () => {
    for (const id of [1, 2, 3, 5, 6, 7, 8, 9] as const) {
      expect(getLineHeight(id)).toBeGreaterThan(1);
      expect(getLineHeight(id)).toBeLessThan(2);
    }
  });
});
