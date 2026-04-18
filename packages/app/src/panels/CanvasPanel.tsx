// Right-side panel: hosts the `<Excalidraw />` canvas and bridges
// sceneStore <-> the MCP client.
//
// Direction of flow:
//   server -> sceneStore -> compile() -> api.updateScene + api.addFiles
//   user onChange -> map element ids -> primitive ids -> client.postSelection
//
// The compile happens in the browser because it's a pure function on the
// already-loaded primitive array. We reuse `resolveBuiltinTheme` to pair
// the snapshot's theme name with the concrete Theme object.
//
// Edit-lock round-tripping (user edits bumping element.version) is not
// wired in PR #13 — see the TODO below. PR #20 owns it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { Primitive, Scene } from '@drawcast/core';
import { compile } from '@drawcast/core';
import type { CompileResult } from '@drawcast/core';
import { useSceneStore } from '../store/sceneStore.js';
import { useSettingsStore } from '../store/settingsStore.js';
import { resolveBuiltinTheme } from '../theme/builtinThemes.js';
import { useMcp, useMcpConnected } from '../mcp/context.js';

// Minimal structural typings for the Excalidraw surface area we touch.
// The package's own .d.ts types pull the entire private app into scope;
// declaring just the bits we use keeps this file decoupled from
// Excalidraw internals (and lets the test mock stand in cleanly).
type ExcalidrawElementLike = {
  id: string;
  customData?: Record<string, unknown> | null | undefined;
};

interface ExcalidrawAppStateLike {
  selectedElementIds: Readonly<Record<string, true>>;
}

interface ExcalidrawImperativeAPILike {
  updateScene: (data: { elements: readonly unknown[] }) => void;
  addFiles: (files: unknown[]) => void;
}

function extractPrimitiveId(el: ExcalidrawElementLike): string | null {
  const cd = el.customData;
  if (cd && typeof cd === 'object') {
    const id = (cd as { drawcastPrimitiveId?: unknown }).drawcastPrimitiveId;
    if (typeof id === 'string') return id;
  }
  return null;
}

function buildScene(primitives: readonly Primitive[], themeName: string): Scene {
  return {
    primitives: new Map(primitives.map((p) => [p.id, p])),
    theme: resolveBuiltinTheme(themeName),
  };
}

function compileSnapshot(
  primitives: readonly Primitive[],
  themeName: string,
): CompileResult | null {
  if (primitives.length === 0) return null;
  return compile(buildScene(primitives, themeName));
}

function arrayEquals(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const SELECTION_DEBOUNCE_MS = 150;

export function CanvasPanel(): JSX.Element {
  const primitives = useSceneStore((s) => s.primitives);
  const themeName = useSceneStore((s) => s.theme);
  const setSelection = useSceneStore((s) => s.setSelection);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const client = useMcp();
  const connected = useMcpConnected();
  const [apiReady, setApiReady] = useState(false);

  const apiRef = useRef<ExcalidrawImperativeAPILike | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedRef = useRef<string[]>([]);

  // Compile whenever the scene snapshot changes. The compile is pure, but
  // we still memoize so re-renders triggered by other props (themeMode)
  // don't redo the work.
  const compiled = useMemo(
    () => compileSnapshot(primitives, themeName),
    [primitives, themeName],
  );

  // Push compiled scene into the Excalidraw API whenever we have both.
  useEffect(() => {
    if (!apiReady) return;
    const api = apiRef.current;
    if (api === null) return;
    const elements = compiled?.elements ?? [];
    api.updateScene({ elements });
    if (compiled?.files !== undefined) {
      const files = Object.values(compiled.files);
      if (files.length > 0) {
        api.addFiles(files);
      }
    }
  }, [apiReady, compiled]);

  // Clean up the debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, []);

  const onChange = (
    elements: readonly ExcalidrawElementLike[],
    appState: ExcalidrawAppStateLike,
  ): void => {
    const selected = appState.selectedElementIds;
    const elementIds = Object.keys(selected);
    if (elementIds.length === 0 && lastPushedRef.current.length === 0) {
      return;
    }
    const byId = new Map<string, ExcalidrawElementLike>();
    for (const el of elements) byId.set(el.id, el);
    const primitiveIds = new Set<string>();
    for (const id of elementIds) {
      const el = byId.get(id);
      if (el === undefined) continue;
      const pid = extractPrimitiveId(el);
      if (pid !== null) primitiveIds.add(pid);
    }
    const nextIds = [...primitiveIds];
    // Reflect locally immediately so any selection-dependent UI doesn't
    // need to wait for the POST round-trip.
    setSelection(nextIds);

    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (client === null) return;
      if (arrayEquals(nextIds, lastPushedRef.current)) return;
      lastPushedRef.current = nextIds;
      void client.postSelection(nextIds).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[canvas] postSelection failed', err);
      });
    }, SELECTION_DEBOUNCE_MS);

    // TODO(PR#20): track element.version deltas here to detect user edits
    // (version > 1 means local mutation) and POST /edit-lock.
  };

  const showOverlay = client === null || !connected;

  return (
    <div
      data-testid="dc-canvas-panel"
      className="relative h-full w-full"
    >
      <Excalidraw
        excalidrawAPI={(api) => {
          apiRef.current = api as unknown as ExcalidrawImperativeAPILike;
          setApiReady(true);
        }}
        onChange={onChange as never}
        theme={themeMode}
        initialData={{
          elements: [],
          appState: { viewBackgroundColor: '#ffffff' },
        }}
      />
      {showOverlay && (
        <div
          role="status"
          aria-live="polite"
          data-testid="dc-canvas-overlay"
          className="pointer-events-none absolute right-dc-md top-dc-md rounded-dc-md bg-dc-bg-panel/80 px-dc-sm py-1 text-[12px] font-mono text-dc-text-secondary shadow-sm"
        >
          Connecting to MCP…
        </div>
      )}
    </div>
  );
}
