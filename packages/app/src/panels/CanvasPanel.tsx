// Right-side panel: hosts the `<Excalidraw />` canvas and bridges
// sceneStore <-> the MCP client.
//
// Direction of flow:
//   server -> sceneStore -> compile() -> api.updateScene + api.addFiles
//   user onChange -> map element ids -> primitive ids -> client.postSelection
//
// PR #17 adds three selection-related affordances on top of PR #13:
//   1. Inbound selection: when `sceneStore.selection` changes (server push),
//      translate primitive ids back to Excalidraw element ids and push them
//      into `appState.selectedElementIds`. A `lastPushed` guard prevents
//      the outbound observer from echoing the update back to the server.
//   2. Right-click on a selected element opens a tiny floating menu with
//      one item, "Give feedback on this node". Clicking it prefills the
//      active terminal with `[node: <primitiveId>] `.
//   3. A selection indicator chip in the top-right shows the count and
//      primitive kind(s), plus an `Esc` affordance to clear.
//
// The compile happens in the browser because it's a pure function on the
// already-loaded primitive array. We reuse `resolveBuiltinTheme` to pair
// the snapshot's theme name with the concrete Theme object.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type {
  ExcalidrawElement,
  Primitive,
  Scene,
} from '@drawcast/core';
import { compile } from '@drawcast/core';
import type { CompileResult } from '@drawcast/core';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types';
import { writeToActiveTerminal } from './TerminalPanel.js';
import { CanvasToolbar } from '../components/CanvasToolbar.js';
import { useSceneStore } from '../store/sceneStore.js';
import { useSettingsStore } from '../store/settingsStore.js';
import { useCanvasStore } from '../store/canvasStore.js';
import { useEditLockStore } from '../store/editLockStore.js';
import { resolveBuiltinTheme } from '../theme/builtinThemes.js';
import { useMcp, useMcpConnected } from '../mcp/context.js';
import { handlePreviewRequest } from '../mcp/preview.js';
import { reconcileElements } from '../mcp/reconcile.js';

// Minimal structural typings for the Excalidraw surface area we touch.
// The package's own .d.ts types pull the entire private app into scope;
// declaring just the bits we use keeps this file decoupled from
// Excalidraw internals (and lets the test mock stand in cleanly).
type ExcalidrawElementLike = {
  id: string;
  // `version` is a monotonically-increasing counter Excalidraw bumps on
  // every local mutation. PR #20 uses it to spot user edits — see the
  // onChange handler below.
  version?: number;
  customData?: Record<string, unknown> | null | undefined;
};

interface ExcalidrawAppStateLike {
  selectedElementIds: Readonly<Record<string, true>>;
}

type SelectedElementIds = Readonly<Record<string, true>>;

interface ExcalidrawImperativeAPILike {
  updateScene: (data: {
    elements?: readonly unknown[];
    appState?: { selectedElementIds?: SelectedElementIds };
  }) => void;
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

/** Human-readable label for a primitive kind, used in the selection chip. */
function kindLabel(kind: Primitive['kind']): string {
  switch (kind) {
    case 'labelBox':
      return 'box';
    case 'connector':
      return 'edge';
    case 'sticky':
      return 'sticky';
    case 'group':
      return 'group';
    case 'frame':
      return 'frame';
    case 'line':
      return 'line';
    case 'freedraw':
      return 'sketch';
    case 'image':
      return 'image';
    case 'embed':
      return 'embed';
    default:
      return 'element';
  }
}

const SELECTION_DEBOUNCE_MS = 150;

interface ContextMenuState {
  x: number;
  y: number;
  primitiveId: string;
}

export function CanvasPanel(): JSX.Element {
  const primitives = useSceneStore((s) => s.primitives);
  const themeName = useSceneStore((s) => s.theme);
  const storeSelection = useSceneStore((s) => s.selection);
  const storeLocked = useSceneStore((s) => s.locked);
  const setSelection = useSceneStore((s) => s.setSelection);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const client = useMcp();
  const connected = useMcpConnected();
  const [apiReady, setApiReady] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const apiRef = useRef<ExcalidrawImperativeAPILike | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedRef = useRef<string[]>([]);
  // Tracks the primitive id set that we most recently pushed INTO the
  // canvas (from the server). When onChange fires with a matching set we
  // treat it as a loopback — see the outbound guard in `onChange`.
  const lastAppliedRef = useRef<string[]>([]);
  // When onChange originates from the user (rather than an inbound apply),
  // it calls `setSelection` which re-triggers the inbound effect. That
  // re-application is a no-op for Excalidraw (user already has it selected)
  // but would corrupt the outbound-dedupe ref. Flipping this flag from
  // `onChange` tells the inbound effect to sync `lastAppliedRef` silently
  // without issuing an updateScene.
  const skipNextApplyRef = useRef<boolean>(false);
  // Holds the most-recent reconciled element array so the next compile can
  // stabilise identity fields against it. This drives both the reconciler
  // and the onChange-time edit detection (which compares `element.version`
  // against the last-seen snapshot).
  const prevReconciledElementsRef = useRef<readonly ExcalidrawElement[] | null>(
    null,
  );
  // Versions observed on the most-recent reconciled push, keyed by element
  // id. onChange compares live element versions against this map to
  // classify a version bump as user-edit (strictly greater) or loopback
  // (equal). Rebuilt from `prevReconciledElementsRef` alongside each push.
  const lastReconciledVersionsRef = useRef<Map<string, number>>(new Map());

  // Compile whenever the scene snapshot changes. The compile is pure, but
  // we still memoize so re-renders triggered by other props (themeMode)
  // don't redo the work.
  const compiled = useMemo(
    () => compileSnapshot(primitives, themeName),
    [primitives, themeName],
  );

  // Push compiled scene into the Excalidraw API whenever we have both.
  // The compile output is first reconciled against the previously-rendered
  // element set so identity fields (id, seed, version, versionNonce) stay
  // stable across recompiles. We also snapshot the resulting versions into
  // `lastReconciledVersionsRef` so the onChange handler can classify
  // subsequent version bumps as user edits vs loopbacks.
  useEffect(() => {
    if (!apiReady) return;
    const api = apiRef.current;
    if (api === null) return;
    if (compiled === null) {
      api.updateScene({ elements: [] });
      prevReconciledElementsRef.current = null;
      lastReconciledVersionsRef.current = new Map();
      return;
    }
    const out = reconcileElements({
      prev: prevReconciledElementsRef.current,
      fresh: compiled.elements,
      files: compiled.files,
    });
    prevReconciledElementsRef.current = out.elements;
    const versions = new Map<string, number>();
    for (const el of out.elements) {
      versions.set(el.id, el.version);
    }
    lastReconciledVersionsRef.current = versions;
    api.updateScene({ elements: out.elements });
    const files = Object.values(out.files);
    if (files.length > 0) {
      api.addFiles(files);
    }
  }, [apiReady, compiled]);

  // Inbound selection sync: when sceneStore.selection changes (pushed by
  // the server or the setSelection helper), translate primitive ids back
  // to element ids via customData round-trip and write them into Excalidraw's
  // appState. We dedupe via `lastAppliedRef` so the outbound onChange handler
  // doesn't immediately re-POST the same ids.
  useEffect(() => {
    if (!apiReady) return;
    const api = apiRef.current;
    if (api === null) return;
    // Prefer the reconciled element set (what's actually rendered in
    // Excalidraw) over the fresh compile output — element ids in the
    // latter might not match what the canvas currently holds.
    const elements = prevReconciledElementsRef.current ?? [];
    if (elements.length === 0) return;

    const desired = [...storeSelection].sort();
    // Avoid a no-op updateScene if nothing changed relative to the last
    // apply. `lastAppliedRef.current` is already sorted.
    if (arrayEquals(desired, lastAppliedRef.current)) return;

    // When the selection change came from our own onChange handler (user
    // selected on the canvas) Excalidraw is already showing it — we don't
    // need to reapply. But we DO need to update `lastAppliedRef` so it
    // stays honest about the current DOM state.
    if (skipNextApplyRef.current) {
      skipNextApplyRef.current = false;
      lastAppliedRef.current = desired;
      return;
    }

    const wanted = new Set(desired);
    const elementIds: string[] = [];
    for (const el of elements as readonly ExcalidrawElementLike[]) {
      const pid = extractPrimitiveId(el);
      if (pid !== null && wanted.has(pid)) {
        elementIds.push(el.id);
      }
    }
    const selectedElementIds: Record<string, true> = {};
    for (const id of elementIds) selectedElementIds[id] = true;
    lastAppliedRef.current = desired;
    api.updateScene({ appState: { selectedElementIds } });
  }, [apiReady, compiled, storeSelection]);

  // Clean up the debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, []);

  // Mirror the server's authoritative `locked` array into `editLockStore`
  // on every scene snapshot. Local `addLocks` fires optimistically from
  // onChange; this effect reconciles the client back to whatever the
  // server currently holds (persistence, other clients, or the Reset Edits
  // round-trip). Because `setLocks` is a full replace, it also covers the
  // case where the server unlocks a primitive we have flagged locally.
  useEffect(() => {
    useEditLockStore.getState().setLocks([...storeLocked]);
  }, [storeLocked]);

  // Wipe the canvasStore slot when the panel tears down so other
  // consumers don't reach a dangling API object.
  useEffect(() => {
    return () => {
      useCanvasStore.getState().setApi(null);
    };
  }, []);

  // Preview pipeline: the MCP server emits `requestPreview` when
  // `draw_get_preview` is invoked. We render the current scene to PNG
  // and POST it back via client.postPreview. The full imperative API is
  // pulled from canvasStore rather than apiRef so the handler also sees
  // the getSceneElements / getFiles / getAppState accessors.
  useEffect(() => {
    if (client === null) return;
    const offPreview = client.onRequestPreview((req) => {
      const api = useCanvasStore.getState().api;
      void handlePreviewRequest(client, api, req);
    });
    return () => {
      offPreview();
    };
  }, [client]);

  // Close the context menu on Escape or on any click outside its DOM.
  useEffect(() => {
    if (contextMenu === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    const onClick = (e: MouseEvent): void => {
      const tgt = e.target as Node | null;
      const menu = document.querySelector('[data-testid="dc-context-menu"]');
      if (menu === null || tgt === null) {
        setContextMenu(null);
        return;
      }
      if (!menu.contains(tgt)) setContextMenu(null);
    };
    window.addEventListener('keydown', onKey);
    // `mousedown` rather than `click` so we dismiss before the click
    // bubbles into any underlying canvas tool.
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [contextMenu]);

  // Show a feedback menu when the user right-clicks a currently-selected
  // primitive. We key on sceneStore.selection rather than digging into
  // Excalidraw's internal state so the menu stays consistent with the chip.
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      if (storeSelection.length === 0) return;
      const first = storeSelection[0];
      if (first === undefined) return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, primitiveId: first });
    },
    [storeSelection],
  );

  const onFeedbackClick = useCallback((): void => {
    if (contextMenu === null) return;
    writeToActiveTerminal(`[node: ${contextMenu.primitiveId}] `);
    setContextMenu(null);
  }, [contextMenu]);

  const clearSelection = useCallback((): void => {
    const api = apiRef.current;
    if (api !== null) {
      api.updateScene({ appState: { selectedElementIds: {} } });
    }
    setSelection([]);
    lastAppliedRef.current = [];
    lastPushedRef.current = [];
  }, [setSelection]);

  // Derive the chip label. Prefer primitive kind summary; fall back to count.
  const chipLabel = useMemo((): string | null => {
    if (storeSelection.length === 0) return null;
    const kinds = new Set<string>();
    const byId = new Map<string, Primitive>();
    for (const p of primitives) byId.set(p.id, p);
    for (const id of storeSelection) {
      const p = byId.get(id);
      if (p !== undefined) kinds.add(kindLabel(p.kind));
    }
    const kindStr = [...kinds].join(', ');
    if (storeSelection.length === 1) {
      return kindStr.length > 0 ? `1 ${kindStr}` : '1 selected';
    }
    return kindStr.length > 0
      ? `${storeSelection.length} selected (${kindStr})`
      : `${storeSelection.length} selected`;
  }, [primitives, storeSelection]);

  const onChange = (
    elements: readonly ExcalidrawElementLike[],
    appState: ExcalidrawAppStateLike,
  ): void => {
    // --- Edit detection ---------------------------------------------------
    // Every onChange is a candidate user edit. An element whose `version`
    // is strictly greater than the one we last rendered means Excalidraw
    // applied a local mutation (drag, resize, text rewrite, …). We compare
    // against `lastReconciledVersionsRef` because that snapshot reflects
    // what we wrote into the canvas — server round-trips come through the
    // reconciler and preserve versions, so they don't trip this check.
    //
    // Ignore elements that never appeared in the last reconcile (newly
    // added by Excalidraw itself — tool creation, clipboard paste — is out
    // of scope for edit-lock; the server-driven flow owns those ids).
    const newlyLocked = new Set<string>();
    const versions = lastReconciledVersionsRef.current;
    for (const el of elements) {
      if (typeof el.version !== 'number') continue;
      const prevVersion = versions.get(el.id);
      if (prevVersion === undefined) continue;
      if (el.version <= prevVersion) continue;
      const pid = extractPrimitiveId(el);
      if (pid === null) continue;
      newlyLocked.add(pid);
      // Update our baseline so a subsequent onChange with the SAME version
      // isn't double-counted (Excalidraw often fires several onChange
      // callbacks per drag; we want one POST, not ten).
      versions.set(el.id, el.version);
    }
    if (newlyLocked.size > 0) {
      const ids = [...newlyLocked];
      useEditLockStore.getState().addLocks(ids);
      if (client !== null) {
        void client.postEditLock(ids, true).catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('[canvas] postEditLock failed', err);
        });
      }
    }

    // --- Selection bridge -------------------------------------------------
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
    const sorted = [...nextIds].sort();

    // Classify this onChange:
    //   - If it matches the selection we most recently applied INTO the
    //     canvas, it's the loopback echo of our own updateScene call. The
    //     store is already in sync; nothing to do.
    //   - Otherwise the user drove the change. Flip `skipNextApplyRef` so
    //     the inbound effect doesn't re-write the same ids into
    //     Excalidraw, and update the store so the chip / context menu see
    //     a current selection.
    const isLoopback = arrayEquals(sorted, lastAppliedRef.current);
    if (!isLoopback) {
      skipNextApplyRef.current = true;
      setSelection(nextIds);
    }

    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (client === null) return;
      if (isLoopback) return;
      // Dedupe rapid-fire outbound posts (moving a selection tool in a drag).
      if (arrayEquals(sorted, lastPushedRef.current)) return;
      lastPushedRef.current = sorted;
      void client.postSelection(nextIds).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[canvas] postSelection failed', err);
      });
    }, SELECTION_DEBOUNCE_MS);
  };

  const showOverlay = client === null || !connected;

  return (
    <div
      ref={containerRef}
      data-testid="dc-canvas-panel"
      className="relative h-full w-full"
      onContextMenu={handleContextMenu}
    >
      <Excalidraw
        excalidrawAPI={(api) => {
          apiRef.current = api as unknown as ExcalidrawImperativeAPILike;
          // Expose the full imperative API so the snapshot button + MCP
          // preview handler can call exportToBlob without prop drilling.
          useCanvasStore
            .getState()
            .setApi(api as unknown as ExcalidrawImperativeAPI);
          setApiReady(true);
        }}
        onChange={onChange as never}
        theme={themeMode}
        initialData={{
          elements: [],
          appState: { viewBackgroundColor: '#ffffff' },
        }}
      />
      <CanvasToolbar />
      {chipLabel !== null && (
        <div
          data-testid="dc-selection-chip"
          className="pointer-events-auto absolute right-dc-md top-dc-md z-10 flex items-center gap-dc-xs rounded-dc-full border border-dc-border-hairline bg-dc-bg-elevated px-dc-md py-1 text-[12px] text-dc-text-primary shadow-dc-e1"
        >
          <span className="inline-block h-1.5 w-1.5 rounded-dc-full bg-dc-accent-primary" />
          <span>{chipLabel}</span>
          <button
            type="button"
            data-testid="dc-selection-clear"
            onClick={clearSelection}
            className="ml-dc-xs rounded-dc-sm px-dc-xs text-[11px] font-mono text-dc-text-secondary hover:bg-dc-bg-hover"
            aria-label="Clear selection"
          >
            Esc
          </button>
        </div>
      )}
      {contextMenu !== null && (
        <div
          data-testid="dc-context-menu"
          role="menu"
          style={{
            position: 'fixed',
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            zIndex: 50,
          }}
          className="min-w-[220px] rounded-dc-md border border-dc-border-hairline bg-dc-bg-elevated py-dc-xs text-[13px] text-dc-text-primary shadow-dc-e2"
        >
          <button
            type="button"
            data-testid="dc-context-menu-feedback"
            onClick={onFeedbackClick}
            className="block w-full px-dc-md py-dc-sm text-left hover:bg-dc-bg-hover"
          >
            Give feedback on this node
          </button>
        </div>
      )}
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
