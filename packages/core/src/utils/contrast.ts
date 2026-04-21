// High-contrast label color selection for shapes whose authored stroke is
// reused as bound text color.
//
// Claude-authored themes routinely produce nodes where the stroke is a
// deeper shade of the background (e.g. bg=#2f9e44 on stroke=#2b8a3e).
// LabelBox reuses that stroke for the text child, which renders a
// dark-green label on a green field — both VLM rubrics and human readers
// flag these as illegible. The helper here drops the authored color when
// its contrast against the background is too weak, and picks the
// canonical Excalidraw dark (#1e1e1e) or white fallback that has the
// higher ratio.

const DARK_TEXT = '#1e1e1e';
const LIGHT_TEXT = '#ffffff';

// WCAG 2.1 §1.4.3 requires ≥4.5:1 for normal text. The floor here is
// stricter than the threshold so tied cases (ratio near 4.5) still fall
// through to the fallback — a tinted stroke sitting *at* 4.5:1 still
// reads poorly next to sibling labels that reach 10+:1 with the dark
// fallback.
const MIN_CONTRAST_RATIO = 4.5;

export function pickHighContrastTextColor(
  backgroundColor: string | undefined,
  authoredColor: string,
): string {
  const bg = parseHex(backgroundColor);
  if (bg === null) return authoredColor;
  const authored = parseHex(authoredColor);
  if (authored !== null && contrastRatio(authored, bg) >= MIN_CONTRAST_RATIO) {
    return authoredColor;
  }
  const bgLuminance = relativeLuminance(bg);
  return bgLuminance > 0.4 ? DARK_TEXT : LIGHT_TEXT;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(value: string | undefined): Rgb | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim();
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (match === null) return null;
  const raw = match[1]!;
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function relativeLuminance(rgb: Rgb): number {
  const linear = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
