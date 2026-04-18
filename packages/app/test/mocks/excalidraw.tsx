// Test-only stand-in for the @excalidraw/excalidraw package. The real
// component drags in CSS + an entire editor; for unit tests we just need
// something that accepts the same props and records them so assertions
// can be made against them.
//
// `capturedProps` is a module-level ref so tests can read the most
// recent props passed into the mock. `resetExcalidrawMock` clears it
// between cases.
//
// The fake `ExcalidrawImperativeAPI` tracks `updateScene` / `addFiles`
// calls so the Canvas panel sees an "API ready" callback and its
// scene-push effects can be observed. PR #18 also exposes the
// getters the preview pipeline reaches for (`getSceneElements`, …) plus
// a mock `exportToBlob` so snapshot/preview tests can assert payloads.

import React, { useEffect, useRef } from 'react';

export interface RecordedApiCall {
  kind: 'updateScene' | 'addFiles';
  arg: unknown;
}

export interface CapturedExcalidrawProps {
  lastElements: readonly unknown[];
  lastTheme: unknown;
  apiCalls: RecordedApiCall[];
  onChange: ((elements: unknown, appState: unknown) => void) | null;
}

export interface ExportBlobCall {
  elements: readonly unknown[];
  appState?: Record<string, unknown>;
  files: unknown;
  mimeType?: string;
  exportPadding?: number;
}

/** Test-controlled blob the next `exportToBlob` call will return. */
let nextExportBlob: Blob | null = null;
let nextExportError: Error | null = null;
const exportCalls: ExportBlobCall[] = [];

export function setNextExportBlob(blob: Blob): void {
  nextExportBlob = blob;
  nextExportError = null;
}

export function setNextExportError(err: Error): void {
  nextExportError = err;
  nextExportBlob = null;
}

export function getExportBlobCalls(): readonly ExportBlobCall[] {
  return exportCalls;
}

const state: CapturedExcalidrawProps = {
  lastElements: [],
  lastTheme: undefined,
  apiCalls: [],
  onChange: null,
};

export function resetExcalidrawMock(): void {
  state.lastElements = [];
  state.lastTheme = undefined;
  state.apiCalls = [];
  state.onChange = null;
  nextExportBlob = null;
  nextExportError = null;
  exportCalls.length = 0;
}

export function getExcalidrawMock(): CapturedExcalidrawProps {
  return state;
}

interface ExcalidrawProps {
  excalidrawAPI?: (api: unknown) => void;
  onChange?: (elements: unknown, appState: unknown, files: unknown) => void;
  theme?: unknown;
  initialData?: unknown;
}

export function Excalidraw(props: ExcalidrawProps): JSX.Element {
  state.lastTheme = props.theme;
  state.onChange = props.onChange
    ? (elements, appState) => props.onChange!(elements, appState, {})
    : null;

  const apiRef = useRef<{
    updateScene: (d: {
      elements?: readonly unknown[];
      appState?: unknown;
    }) => void;
    addFiles: (f: unknown[]) => void;
    getSceneElements: () => readonly unknown[];
    getAppState: () => Record<string, unknown>;
    getFiles: () => Record<string, unknown>;
  } | null>(null);

  if (apiRef.current === null) {
    apiRef.current = {
      updateScene: (data: {
        elements?: readonly unknown[];
        appState?: unknown;
      }) => {
        // Only mutate `lastElements` when the call actually supplies them.
        // PR #17 issues appState-only updates for inbound selection sync —
        // those shouldn't clobber the captured element array.
        if (data.elements !== undefined) {
          state.lastElements = data.elements;
        }
        state.apiCalls.push({ kind: 'updateScene', arg: data });
      },
      addFiles: (files: unknown[]) => {
        state.apiCalls.push({ kind: 'addFiles', arg: files });
      },
      // Accessors the preview / snapshot paths pull from. Tests can mutate
      // `state.lastElements` to control what the handler sees.
      getSceneElements: () => state.lastElements,
      getAppState: () => ({ viewBackgroundColor: '#ffffff' }),
      getFiles: () => ({}),
    };
  }

  useEffect(() => {
    if (props.excalidrawAPI && apiRef.current !== null) {
      props.excalidrawAPI(apiRef.current);
    }
  }, [props.excalidrawAPI]);

  return <div data-testid="excalidraw-mock" />;
}

/**
 * Mock `exportToBlob` — records the call for assertions and returns the
 * test-provided blob. Tests set a blob via `setNextExportBlob` (or an
 * error via `setNextExportError`) before exercising the code path that
 * triggers an export.
 */
export async function exportToBlob(
  opts: ExportBlobCall,
): Promise<Blob> {
  exportCalls.push(opts);
  if (nextExportError !== null) {
    throw nextExportError;
  }
  if (nextExportBlob === null) {
    // Fall back to a tiny fake PNG byte stream so nothing crashes if a
    // test forgets to prime the mock. The preview-handler assertions
    // focus on the payload path, not the image bytes.
    return new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
  }
  return nextExportBlob;
}
