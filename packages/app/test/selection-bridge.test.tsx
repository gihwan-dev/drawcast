// PR #17 tests: inbound selection sync + context menu + loop guard.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabelBox, PrimitiveId } from '@drawcast/core';
import { useSceneStore } from '../src/store/sceneStore.js';
import { useSidecarStore } from '../src/store/sidecarStore.js';
import { useSettingsStore } from '../src/store/settingsStore.js';
import { useChatStore } from '../src/store/chatStore.js';
import { CanvasPanel } from '../src/panels/CanvasPanel.js';
import type { McpClient } from '../src/mcp/client.js';
import { McpClientContext } from '../src/mcp/context.js';
import {
  getExcalidrawMock,
  resetExcalidrawMock,
} from './mocks/excalidraw.js';

function createFakeClient(): {
  client: McpClient;
  calls: { ids: string[] }[];
} {
  const calls: { ids: string[] }[] = [];
  const client: McpClient = {
    baseUrl: 'http://test',
    connect: () => {},
    disconnect: () => {},
    postSelection: async (ids) => {
      calls.push({ ids: [...ids] });
    },
    postEditLock: async () => {},
    postClipboardAck: async () => {},
    postPreview: async () => {},
    onScene: () => () => {},
    onRequestPreview: () => () => {},
    onRequestClipboard: () => () => {},
    onConnectionChange: () => () => {},
  };
  return { client, calls };
}

function renderWithMcp(client: McpClient | null, connected: boolean): void {
  render(
    <McpClientContext.Provider value={{ client, connected }}>
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

describe('selection bridge — inbound', () => {
  beforeEach(() => {
    resetExcalidrawMock();
    act(() => {
      useSceneStore.getState().reset();
      useChatStore.getState().reset();
      useSidecarStore.setState({ status: 'ready', port: 43017, lastExitCode: null });
      useSettingsStore.setState({
        themeMode: 'light',
        panelRatio: 0.4,
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushes server-supplied selection back into Excalidraw as element IDs', async () => {
    const { client } = createFakeClient();
    renderWithMcp(client, true);

    await act(async () => {
      useSceneStore.getState().setSnapshot({
        primitives: [primitive],
        theme: 'sketchy',
        selection: [],
        locked: [],
      });
    });

    const mock = getExcalidrawMock();
    const elementIds = (mock.lastElements as ReadonlyArray<{ id: string }>).map(
      (el) => el.id,
    );
    expect(elementIds.length).toBeGreaterThan(0);

    // Simulate the server pushing a selection that includes our primitive.
    await act(async () => {
      useSceneStore.getState().setSelection(['p-login']);
    });

    // The panel should have issued an updateScene call with appState.
    const withAppState = mock.apiCalls.find(
      (c) =>
        c.kind === 'updateScene' &&
        (c.arg as { appState?: unknown }).appState !== undefined,
    );
    expect(withAppState).toBeDefined();
    const ids = Object.keys(
      (withAppState!.arg as {
        appState: { selectedElementIds: Record<string, true> };
      }).appState.selectedElementIds,
    );
    // Every element from the compiled LabelBox (rect + text) that maps
    // back to p-login should be selected.
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(elementIds).toContain(id);
    }
  });
});

describe('selection bridge — outbound loop guard', () => {
  beforeEach(() => {
    resetExcalidrawMock();
    act(() => {
      useSceneStore.getState().reset();
      useChatStore.getState().reset();
      useSidecarStore.setState({ status: 'ready', port: 43017, lastExitCode: null });
      useSettingsStore.setState({
        themeMode: 'light',
        panelRatio: 0.4,
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips postSelection when Excalidraw echoes back our applied selection', async () => {
    vi.useFakeTimers();
    const { client, calls } = createFakeClient();
    renderWithMcp(client, true);

    await act(async () => {
      useSceneStore.getState().setSnapshot({
        primitives: [primitive],
        theme: 'sketchy',
        selection: [],
        locked: [],
      });
    });

    // Inbound: server tells us p-login is selected.
    await act(async () => {
      useSceneStore.getState().setSelection(['p-login']);
    });

    const mock = getExcalidrawMock();
    const elements = mock.lastElements as ReadonlyArray<{ id: string }>;
    const selectedElementIds = Object.fromEntries(
      elements.map((el) => [el.id, true]),
    );

    // Excalidraw echoes this back via onChange. The guard should see the
    // same primitive id set and not re-POST to /selection.
    act(() => {
      mock.onChange?.(elements, { selectedElementIds });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(calls.length).toBe(0);
  });
});

describe('selection bridge — context menu', () => {
  beforeEach(() => {
    resetExcalidrawMock();
    act(() => {
      useSceneStore.getState().reset();
      useChatStore.getState().reset();
      useSidecarStore.setState({ status: 'ready', port: 43017, lastExitCode: null });
      useSettingsStore.setState({
        themeMode: 'light',
        panelRatio: 0.4,
      });
    });
  });

  it('right-click on a selected element appends [node: id] to the chat draft', async () => {
    const { client } = createFakeClient();
    renderWithMcp(client, true);

    await act(async () => {
      useSceneStore.getState().setSnapshot({
        primitives: [primitive],
        theme: 'sketchy',
        selection: ['p-login'],
        locked: [],
      });
    });

    const panel = screen.getByTestId('dc-canvas-panel');

    // Simulate a right-click somewhere over the panel.
    fireEvent.contextMenu(panel, { clientX: 100, clientY: 120 });

    // The floating menu should appear.
    const menuItem = screen.getByTestId('dc-context-menu-feedback');
    expect(menuItem).toBeInTheDocument();

    fireEvent.click(menuItem);

    // The chat composer's draft should now include the node reference.
    expect(useChatStore.getState().draft.text).toContain('[node: p-login]');
  });
});
