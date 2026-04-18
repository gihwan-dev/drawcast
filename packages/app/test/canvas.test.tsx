// Canvas panel smoke tests. The real `@excalidraw/excalidraw` package is
// mocked via `./mocks/excalidraw.tsx` — see the header there for the
// recording contract.

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabelBox, PrimitiveId } from '@drawcast/core';
import {
  cleanTheme,
  monoTheme,
  sketchyTheme,
} from '@drawcast/core';
import { resolveBuiltinTheme } from '../src/theme/builtinThemes.js';
import { useSceneStore } from '../src/store/sceneStore.js';
import { useSidecarStore } from '../src/store/sidecarStore.js';
import { useSettingsStore } from '../src/store/settingsStore.js';
import { CanvasPanel } from '../src/panels/CanvasPanel.js';
import type { McpClient } from '../src/mcp/client.js';
import { McpClientContext } from '../src/mcp/context.js';
import {
  getExcalidrawMock,
  resetExcalidrawMock,
} from './mocks/excalidraw.js';

// The Excalidraw module is mocked globally in test/setup.ts. We import
// the same mock here to read back the captured props.

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

function renderWithMcp(
  client: McpClient | null,
  connected: boolean,
): ReturnType<typeof render> {
  return render(
    <McpClientContext.Provider value={{ client, connected }}>
      <CanvasPanel />
    </McpClientContext.Provider>,
  );
}

describe('resolveBuiltinTheme', () => {
  it('maps known names back to core theme objects and falls back to sketchy', () => {
    expect(resolveBuiltinTheme('sketchy')).toBe(sketchyTheme);
    expect(resolveBuiltinTheme('clean')).toBe(cleanTheme);
    expect(resolveBuiltinTheme('mono')).toBe(monoTheme);
    expect(resolveBuiltinTheme('unknown-theme-name')).toBe(sketchyTheme);
  });
});

describe('CanvasPanel', () => {
  beforeEach(() => {
    resetExcalidrawMock();
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
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts the Excalidraw host without throwing', () => {
    const { client } = createFakeClient();
    const { getByTestId } = renderWithMcp(client, true);
    expect(getByTestId('excalidraw-mock')).toBeInTheDocument();
    expect(getByTestId('dc-canvas-panel')).toBeInTheDocument();
  });

  it('pushes a LabelBox snapshot into Excalidraw as compiled elements', async () => {
    const { client } = createFakeClient();
    renderWithMcp(client, true);

    const primitive: LabelBox = {
      kind: 'labelBox',
      id: 'p-box' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 0],
      text: 'hi',
    };
    await act(async () => {
      useSceneStore.getState().setSnapshot({
        primitives: [primitive],
        theme: 'sketchy',
        selection: [],
        locked: [],
      });
    });

    const mock = getExcalidrawMock();
    expect(mock.lastElements.length).toBeGreaterThan(0);
    // LabelBox emits a rectangle + a text element.
    expect(mock.apiCalls.some((c) => c.kind === 'updateScene')).toBe(true);
    // Each emitted element should be tagged with drawcastPrimitiveId.
    for (const el of mock.lastElements) {
      const cd = (el as { customData?: { drawcastPrimitiveId?: string } })
        .customData;
      expect(cd?.drawcastPrimitiveId).toBe('p-box');
    }
  });

  it('debounces selection changes and posts primitive ids once', async () => {
    vi.useFakeTimers();
    const { client, calls } = createFakeClient();

    renderWithMcp(client, true);

    const primitive: LabelBox = {
      kind: 'labelBox',
      id: 'sel-box' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 0],
      text: 'hi',
    };
    await act(async () => {
      useSceneStore.getState().setSnapshot({
        primitives: [primitive],
        theme: 'sketchy',
        selection: [],
        locked: [],
      });
    });

    const mock = getExcalidrawMock();
    const elements = mock.lastElements as ReadonlyArray<{ id: string }>;
    expect(elements.length).toBeGreaterThan(0);
    // Construct a "user selected every element" app state.
    const selectedElementIds = Object.fromEntries(
      elements.map((el) => [el.id, true]),
    );

    // Fire onChange twice in quick succession — only the last should post.
    act(() => {
      mock.onChange?.(elements, { selectedElementIds });
      mock.onChange?.(elements, { selectedElementIds });
    });

    expect(calls.length).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(calls.length).toBe(1);
    expect(calls[0]!.ids).toEqual(['sel-box']);
  });
});
