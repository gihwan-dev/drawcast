// Map a snapshot's theme name ('sketchy' | 'clean' | 'mono') back to the
// concrete `Theme` object compiled-in to `@drawcast/core`. The sidecar
// ships the theme name rather than the whole object so the scene payload
// stays small.
import { sketchyTheme, cleanTheme, monoTheme, type Theme } from '@drawcast/core';

export function resolveBuiltinTheme(name: string): Theme {
  if (name === 'clean') return cleanTheme;
  if (name === 'mono') return monoTheme;
  return sketchyTheme;
}
