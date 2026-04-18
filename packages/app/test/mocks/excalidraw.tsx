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
// scene-push effects can be observed.

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
    };
  }

  useEffect(() => {
    if (props.excalidrawAPI && apiRef.current !== null) {
      props.excalidrawAPI(apiRef.current);
    }
  }, [props.excalidrawAPI]);

  return <div data-testid="excalidraw-mock" />;
}
