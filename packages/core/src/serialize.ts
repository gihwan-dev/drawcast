// Serialize a CompileResult into one of the three Excalidraw-compatible
// envelopes. Pure functions — no IO, no DOM. See docs/03-compile-pipeline.md
// (§ "Serialization") and docs/08-excalidraw-reference.md lines 219-289.
//
// Pitfall guards:
//   P23 — keep `type` string straight: 'excalidraw' for files,
//         'excalidraw/clipboard' for paste payloads.
//   P24 — appState is an OBJECT, never a stringified JSON.
//
// Element order is preserved from the compile result; `isDeleted: true`
// elements are filtered out (Excalidraw's `restore` treats them the same
// but the on-disk format is cleaner without them).
//
// The Obsidian adapter wraps the full file envelope in the plugin's
// markdown/code-fence layout so `.excalidraw.md` files round-trip.

import type { CompileResult } from './compile/context.js';
import type {
  BinaryFiles,
  ExcalidrawElement,
} from './types/excalidraw.js';

/** Full `.excalidraw` file envelope. */
export interface ExcalidrawFileEnvelope {
  type: 'excalidraw';
  version: 2;
  source: string;
  elements: ExcalidrawElement[];
  appState: {
    viewBackgroundColor: string;
    gridSize: number | null;
    gridStep?: number;
  };
  files: BinaryFiles;
}

/** Minimal clipboard envelope (no appState / version / source). */
export interface ExcalidrawClipboardEnvelope {
  type: 'excalidraw/clipboard';
  elements: ExcalidrawElement[];
  files?: BinaryFiles;
}

export interface SerializeOptions {
  /** Attributed source URL baked into the file envelope. */
  source?: string;
  /** Background colour baked into the appState. */
  viewBackgroundColor?: string;
  /** Grid size; `null` disables the grid. */
  gridSize?: number | null;
}

const DEFAULT_SOURCE = 'https://drawcast.local';
const DEFAULT_BACKGROUND = '#ffffff';
const DEFAULT_GRID_STEP = 5;

function liveElements(
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  return elements.filter((el) => !el.isDeleted);
}

/**
 * Wrap a compile result in the official `.excalidraw` file envelope.
 * The returned object is plain JSON — safe to `JSON.stringify`.
 */
export function serializeAsExcalidrawFile(
  result: CompileResult,
  options?: SerializeOptions,
): ExcalidrawFileEnvelope {
  const source = options?.source ?? DEFAULT_SOURCE;
  const viewBackgroundColor =
    options?.viewBackgroundColor ?? DEFAULT_BACKGROUND;
  const gridSize = options?.gridSize ?? null;

  const appState: ExcalidrawFileEnvelope['appState'] =
    gridSize === null
      ? { viewBackgroundColor, gridSize: null }
      : { viewBackgroundColor, gridSize, gridStep: DEFAULT_GRID_STEP };

  return {
    type: 'excalidraw',
    version: 2,
    source,
    elements: liveElements(result.elements),
    appState,
    files: result.files,
  };
}

/**
 * Build the paste-friendly clipboard envelope. `files` is only present when
 * the compile actually produced any binary files (images).
 */
export function serializeAsClipboardJSON(
  result: CompileResult,
): ExcalidrawClipboardEnvelope {
  const elements = liveElements(result.elements);
  const hasFiles = Object.keys(result.files).length > 0;
  if (!hasFiles) {
    return { type: 'excalidraw/clipboard', elements };
  }
  return { type: 'excalidraw/clipboard', elements, files: result.files };
}

/**
 * Serialise as an Obsidian-compatible `.excalidraw.md` body. The drawing JSON
 * is embedded inside an HTML-like `%% ... %%` comment with a fenced code
 * block, matching the Obsidian Excalidraw plugin's parser expectations.
 */
export function serializeAsObsidianMarkdown(
  result: CompileResult,
  options?: SerializeOptions & { title?: string; preview?: string },
): string {
  const envelope = serializeAsExcalidrawFile(result, options);
  const drawingJSON = JSON.stringify(envelope, null, 2);

  const lines: string[] = [];
  lines.push('---');
  lines.push('excalidraw-plugin: parsed');
  lines.push('tags: [excalidraw]');
  lines.push('---');
  lines.push('');
  lines.push(
    '==\u26a0  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. \u26a0==',
  );
  if (options?.preview) {
    lines.push('');
    lines.push(options.preview);
  }
  lines.push('');
  if (options?.title) {
    lines.push(`# ${options.title}`);
    lines.push('');
  }
  lines.push('# Text Elements');
  lines.push('');
  lines.push('%%');
  lines.push('# Drawing');
  lines.push('```json');
  lines.push(drawingJSON);
  lines.push('```');
  lines.push('%%');
  lines.push('');
  return lines.join('\n');
}
