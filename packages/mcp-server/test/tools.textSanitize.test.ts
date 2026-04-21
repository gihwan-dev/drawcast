// Unit coverage for the label-text sanitiser shared by every upsert tool
// that accepts user-authored text (box / edge / sticky / frame).

import { describe, expect, it } from 'vitest';
import { sanitizeLabelText } from '../src/tools/helpers/textSanitize.js';

describe('sanitizeLabelText', () => {
  it('leaves plain text untouched', () => {
    expect(sanitizeLabelText('hello')).toBe('hello');
  });

  it('leaves real newlines untouched', () => {
    expect(sanitizeLabelText('line1\nline2')).toBe('line1\nline2');
  });

  it('converts a literal backslash-n into a real newline', () => {
    // The source string contains two characters: backslash + 'n'.
    expect(sanitizeLabelText('line1\\nline2')).toBe('line1\nline2');
  });

  it('handles mixed real and literal newlines', () => {
    expect(sanitizeLabelText('a\nb\\nc')).toBe('a\nb\nc');
  });

  it('converts multiple literal newlines in the same string', () => {
    expect(sanitizeLabelText('재시도 횟수\\n초과?\\n재시도')).toBe(
      '재시도 횟수\n초과?\n재시도',
    );
  });

  it('is idempotent', () => {
    const once = sanitizeLabelText('a\\nb');
    expect(sanitizeLabelText(once)).toBe(once);
  });

  it('handles empty strings', () => {
    expect(sanitizeLabelText('')).toBe('');
  });
});
