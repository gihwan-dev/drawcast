// PR #20 edit-lock tests — covers the three critical branches:
//   1. An onChange with a version bump AFTER a server push is classified as
//      a user edit and triggers `postEditLock([id], true)`.
//   2. An onChange whose versions equal the just-rendered values is a
//      loopback from our own updateScene and MUST NOT trigger a POST.
//   3. The "Reset edits" button posts `locked: false` and clears the local
//      editLockStore.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabelBox, PrimitiveId } from '@drawcast/core';
import { useSceneStore } from '../src/store/sceneStore.js';
import { useSidecarStore } from '../src/store/sidecarStore.js';
import { useSettingsStore } from '../src/store/settingsStore.js';
import { useEditLockStore } from '../src/store/editLockStore.js';
import { useToastStore } from '../src/store/toastStore.js';
import { CanvasPanel } from '../src/panels/CanvasPanel.js';
import { CanvasToolbar } from '../src/components/CanvasToolbar.js';
import type { McpClient } from '../src/mcp/client.js';
import { McpClientContext } from '../src/mcp/context.js';
import {
  getExcalidrawMock,
  resetExcalidrawMock,
} from './mocks/excalidraw.js';

interface EditLockCall {
  ids: readonly string[];
  locked: boolean;
}

function createFakeClient(): {
  client: McpClient;
  editLockCalls: EditLockCall[];
} {
  const editLockCalls: EditLockCall[] = [];
  const client: McpClient = {
    baseUrl: 'http://test',
    connect: () => {},
    disconnect: () => {},
    postSelection: async () => {},
    postEditLock: async (ids, locked) => {
      editLockCalls.push({ ids: [...ids], locked });
    },
    postClipboardAck: async () => {},
    postPreview: async () => {},
    onScene: () => () => {},
    onRequestPreview: () => () => {},
    onRequestClipboard: () => () => {},
    onConnectionChange: () => () => {},
  };
  return { client, editLockCalls };
}

function renderWithMcp(client: McpClient | null): void {
  render(
    <McpClientContext.Provider value={{ client, connected: true }}>
      <CanvasPanel />
    </McpClientContext.Provider>,
  );
}

const primitive: LabelBox = {
  kind: 'labelBox',
  id: 'p-login' as PrimitiveId,
  shape: 'rectangle',
  at: [0, 0],
  text: 'login',
};

function resetStores(): void {
  act(() => {
    useSceneStore.getState().reset();
    useSidecarStore.setState({
      status: 'ready',
      port: 43017,
      lastExitCode: null,
    });
    useSettingsStore.setState({
      themeMode: 'light',
      cliChoice: null,
      panelRatio: 0.4,
    });
    useEditLockStore.setState({ lockedIds: new Set() });
    useToastStore.getState().clear();
  });
}

describe('edit-lock detection', () => {
  beforeEach(() => {
    resetExcalidrawMock();
    resetStores();
  });

  it('posts editLock when an element version increases after a server push', async () => {
    const { client, editLockCalls } = createFakeClient();
    renderWithMcp(client);

    await act(async () => {
      useSceneStore.getState().setSnapshot({
        primitives: [primitive],
        theme: 'sketchy',
        selection: [],
        locked: [],
      });
    });

    const mock = getExcalidrawMock();
    const rendered = mock.lastElements as ReadonlyArray<{
      id: string;
      version: number;
      customData?: { drawcastPrimitiveId?: string };
    }>;
    expect(rendered.length).toBeGreaterThan(0);

    // Simulate the user dragging the rectangle — Excalidraw fires onChange
    // with a BUMPED version on at least one element.
    const mutated = rendered.map((el) => ({
      ...el,
      version: el.version + 2,
    }));

    await act(async () => {
      mock.onChange?.(mutated, { selectedElementIds: {} });
    });

    expect(editLockCalls.length).toBe(1);
    expect(editLockCalls[0]!.locked).toBe(true);
    expect(editLockCalls[0]!.ids).toContain('p-login');

    // Local store should optimistically reflect the lock.
    expect(useEditLockStore.getState().lockedIds.has('p-login')).toBe(true);
  });

  it('does NOT post editLock when onChange echoes the rendered versions', async () => {
    const { client, editLockCalls } = createFakeClient();
    renderWithMcp(client);

    await act(async () => {
      useSceneStore.getState().setSnapshot({
        primitives: [primitive],
        theme: 'sketchy',
        selection: [],
        locked: [],
      });
    });

    const mock = getExcalidrawMock();
    const rendered = mock.lastElements as ReadonlyArray<{
      id: string;
      version: number;
    }>;
    expect(rendered.length).toBeGreaterThan(0);

    // Echo the exact element array back through onChange — same ids, same
    // versions. This is what Excalidraw does right after our updateScene.
    await act(async () => {
      mock.onChange?.(rendered, { selectedElementIds: {} });
    });

    expect(editLockCalls.length).toBe(0);
    expect(useEditLockStore.getState().lockedIds.size).toBe(0);
  });
});

describe('Reset edits button', () => {
  beforeEach(() => {
    resetExcalidrawMock();
    resetStores();
  });

  it('posts locked=false, clears the store, and toasts on click', async () => {
    const { client, editLockCalls } = createFakeClient();
    render(
      <McpClientContext.Provider value={{ client, connected: true }}>
        <CanvasToolbar />
      </McpClientContext.Provider>,
    );

    // The button is conditionally rendered — nothing to click until at
    // least one primitive is locked.
    expect(screen.queryByTestId('dc-toolbar-reset-edits')).toBeNull();

    act(() => {
      useEditLockStore.getState().addLocks(['p-login', 'p-db']);
    });

    const button = await screen.findByTestId('dc-toolbar-reset-edits');
    await act(async () => {
      fireEvent.click(button);
    });
    // Give the async POST a chance to resolve.
    await act(async () => {
      await Promise.resolve();
    });

    expect(editLockCalls.length).toBe(1);
    expect(editLockCalls[0]!.locked).toBe(false);
    expect([...editLockCalls[0]!.ids].sort()).toEqual(['p-db', 'p-login']);
    expect(useEditLockStore.getState().lockedIds.size).toBe(0);

    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.message === 'Edits reset')).toBe(true);
  });
});
