import { describe, expect, it } from 'vitest';
import { measureText } from '../src/measure.js';
import { wrapText } from '../src/wrap.js';

describe('wrapText', () => {
  it('wraps long text into multiple lines at maxWidth', () => {
    const text = 'the quick brown fox jumps over the lazy dog';
    const wrapped = wrapText({
      text,
      maxWidth: 100,
      fontSize: 20,
      fontFamily: 5,
    });
    const lines = wrapped.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    // Every line must fit within the budget (allowing small slop for ceil).
    for (const line of lines) {
      const w = measureText({ text: line, fontSize: 20, fontFamily: 5 }).width;
      expect(w).toBeLessThanOrEqual(100 + 5);
    }
  });

  it('hard-breaks a single word longer than maxWidth', () => {
    // "abcdefghij" @ 20px Excalifont ≈ 110 > 50 → must split.
    const wrapped = wrapText({
      text: 'abcdefghij',
      maxWidth: 50,
      fontSize: 20,
      fontFamily: 5,
    });
    const lines = wrapped.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    // Every chunk fits.
    for (const line of lines) {
      const w = measureText({ text: line, fontSize: 20, fontFamily: 5 }).width;
      expect(w).toBeLessThanOrEqual(50 + 5);
    }
    // No character was dropped.
    expect(lines.join('')).toBe('abcdefghij');
  });

  it('breaks CJK at any character boundary', () => {
    // CJK has no spaces; algorithm must be able to break mid-string.
    // "안녕하세요" @ 20px → width ≈ 110. With maxWidth 50 → expect 3+ lines.
    const wrapped = wrapText({
      text: '안녕하세요',
      maxWidth: 50,
      fontSize: 20,
      fontFamily: 5,
    });
    const lines = wrapped.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.join('')).toBe('안녕하세요');
    for (const line of lines) {
      const w = measureText({ text: line, fontSize: 20, fontFamily: 5 }).width;
      expect(w).toBeLessThanOrEqual(50 + 5);
    }
  });

  it('preserves explicit newlines as paragraph breaks', () => {
    const wrapped = wrapText({
      text: 'first\nsecond',
      maxWidth: 500,
      fontSize: 20,
      fontFamily: 5,
    });
    // Both lines easily fit; the \n must survive unaltered.
    expect(wrapped).toBe('first\nsecond');
  });

  it('prefers whitespace boundaries over mid-CJK-word breaks', () => {
    // Box width 220 → inner width 180. The full line
    // "이메일 / 비밀번호 입력" doesn't fit (≈242px), but
    // "이메일 / 비밀번호" alone (≈176px) does. The wrapper must break at
    // the whitespace before "입력", NOT inside "비밀번호".
    const wrapped = wrapText({
      text: '이메일 / 비밀번호 입력',
      maxWidth: 180,
      fontSize: 20,
      fontFamily: 5,
    });
    const lines = wrapped.split('\n');
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(line.includes('비밀번호') || !line.includes('비밀번')).toBe(true);
      expect(line.includes('비밀번호') || !line.includes('번호')).toBe(true);
    }
    expect(lines[1]?.startsWith(' ')).toBe(false);
  });

  it('keeps an empty paragraph as an empty line', () => {
    const wrapped = wrapText({
      text: 'a\n\nb',
      maxWidth: 500,
      fontSize: 20,
      fontFamily: 5,
    });
    expect(wrapped).toBe('a\n\nb');
  });

  it('handles a line that already fits without splitting', () => {
    const wrapped = wrapText({
      text: 'short',
      maxWidth: 500,
      fontSize: 20,
      fontFamily: 5,
    });
    expect(wrapped).toBe('short');
  });
});
