// PR #18 preview-pipeline tests.
//
// We cover three paths:
//   1. `handlePreviewRequest` happy-path — exportToBlob runs, the base64
//      payload makes it to client.postPreview.
//   2. `handlePreviewRequest` failure path — exportToBlob throws, we still
//      ack with an empty payload so the server-side await resolves.
//   3. Snapshot button end-to-end — click → Rust save_preview_bytes →
//      terminal prefill → success toast.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { handlePreviewRequest } from '../src/mcp/preview.js';
import { SnapshotButton } from '../src/components/SnapshotButton.js';
import type { McpClient } from '../src/mcp/client.js';
import { useCanvasStore } from '../src/store/canvasStore.js';
import { useSessionStore } from '../src/store/sessionStore.js';
import { useToastStore } from '../src/store/toastStore.js';
import {
  __resetActiveTerminalForTests,
  writeToActiveTerminal,
} from '../src/panels/TerminalPanel.js';
import {
  getExportBlobCalls,
  resetExcalidrawMock,
  setNextExportBlob,
  setNextExportError,
} from './mocks/excalidraw.js';

// Match the CLI service mock shape from other tests so rendering the
// TopBar/SnapshotButton doesn't fail on Tauri invocations we don't care
// about here.
vi.mock('../src/services/cli.js', () => ({
  registerCli: vi.fn(async () => 'added'),
  spawnCli: vi.fn(async () => undefined),
  sendStdin: vi.fn(async () => undefined),
  resizeCli: vi.fn(async () => undefined),
  shutdownCli: vi.fn(async () => undefined),
  getDefaultSessionPath: vi.fn(async () => '/tmp/drawcast-session'),
  subscribeCliOutput: vi.fn(() => () => undefined),
  subscribeCliExit: vi.fn(() => () => undefined),
}));

// Spy on `writeToActiveTerminal` so we can assert the @previews prefill.
vi.mock('../src/panels/TerminalPanel.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/panels/TerminalPanel.js')
  >('../src/panels/TerminalPanel.js');
  return {
    ...actual,
    writeToActiveTerminal: vi.fn(actual.writeToActiveTerminal),
  };
});

const invokeMock = vi.mocked(invoke);
const writeMock = vi.mocked(writeToActiveTerminal);

interface PreviewPost {
  requestId: string;
  data: string;
  mimeType: string;
}

function createSpyClient(): { client: McpClient; posts: PreviewPost[] } {
  const posts: PreviewPost[] = [];
  const client: McpClient = {
    baseUrl: 'http://test',
    connect: () => {},
    disconnect: () => {},
    postSelection: async () => {},
    postEditLock: async () => {},
    postClipboardAck: async () => {},
    postPreview: async (requestId, data, mimeType) => {
      posts.push({ requestId, data, mimeType });
    },
    onScene: () => () => {},
    onRequestPreview: () => () => {},
    onRequestClipboard: () => () => {},
    onConnectionChange: () => () => {},
  };
  return { client, posts };
}

/** Small stub that looks just enough like ExcalidrawImperativeAPI. */
function makeApi() {
  return {
    getSceneElements: () => [],
    getAppState: () => ({ viewBackgroundColor: '#ffffff' }),
    getFiles: () => ({}),
    // The following are required by the type but unused by the preview
    // handler — safe to leave as no-ops.
    updateScene: () => {},
    addFiles: () => {},
  };
}

describe('handlePreviewRequest', () => {
  beforeEach(() => {
    resetExcalidrawMock();
  });

  it('exports a PNG and posts the base64 payload back to the server', async () => {
    const { client, posts } = createSpyClient();
    // A five-byte payload makes the base64 assertion easy to read:
    // [72,73,74,75,76] → 'SElKS0w='.
    setNextExportBlob(
      new Blob([new Uint8Array([72, 73, 74, 75, 76])], {
        type: 'image/png',
      }),
    );

    await handlePreviewRequest(
      client,
      makeApi() as unknown as Parameters<typeof handlePreviewRequest>[1],
      { requestId: 'req-1', format: 'png', scale: 2 },
    );

    const calls = getExportBlobCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.mimeType).toBe('image/png');
    expect(
      (calls[0]!.appState as { exportScale?: number } | undefined)
        ?.exportScale,
    ).toBe(2);

    expect(posts).toHaveLength(1);
    expect(posts[0]!.requestId).toBe('req-1');
    expect(posts[0]!.mimeType).toBe('image/png');
    expect(posts[0]!.data).toBe('SElKS0w=');
  });

  it('posts an empty payload when exportToBlob throws', async () => {
    const { client, posts } = createSpyClient();
    setNextExportError(new Error('render failed'));

    await handlePreviewRequest(
      client,
      makeApi() as unknown as Parameters<typeof handlePreviewRequest>[1],
      { requestId: 'req-2' },
    );

    expect(posts).toHaveLength(1);
    expect(posts[0]!.requestId).toBe('req-2');
    expect(posts[0]!.data).toBe('');
    expect(posts[0]!.mimeType).toBe('image/png');
  });
});

describe('SnapshotButton', () => {
  beforeEach(() => {
    resetExcalidrawMock();
    writeMock.mockClear();
    invokeMock.mockReset();
    __resetActiveTerminalForTests();
    act(() => {
      useSessionStore.setState({
        id: null,
        path: '/tmp/drawcast-session',
        current: null,
        list: [],
      });
      useCanvasStore.getState().setApi(null);
      useToastStore.getState().clear();
    });
  });

  afterEach(() => {
    invokeMock.mockReset();
  });

  it('saves a snapshot, prefills the terminal, and shows a success toast', async () => {
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'save_preview_bytes') {
        const payload = args as { filename: string };
        return `/tmp/drawcast-session/previews/${payload.filename}`;
      }
      return null;
    });

    // Seed the canvas store with an API stub so the button path has
    // something to export from. The cast is deliberate — the real
    // ExcalidrawImperativeAPI has far more surface area than the preview
    // pipeline needs; the stub covers the methods this test exercises.
    const api = makeApi() as unknown as Parameters<
      ReturnType<typeof useCanvasStore.getState>['setApi']
    >[0];
    act(() => {
      useCanvasStore.getState().setApi(api);
    });
    setNextExportBlob(
      new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    );

    render(<SnapshotButton />);
    const btn = screen.getByTestId('dc-snapshot-button');

    await act(async () => {
      fireEvent.click(btn);
      // Let the click handler's promise chain settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const saveCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === 'save_preview_bytes',
    );
    expect(saveCalls).toHaveLength(1);
    const payload = saveCalls[0]![1] as {
      sessionPath: string;
      filename: string;
      data: number[];
    };
    expect(payload.sessionPath).toBe('/tmp/drawcast-session');
    expect(payload.filename).toMatch(/^snap-\d+\.png$/);
    expect(payload.data).toEqual([1, 2, 3]);

    expect(writeMock).toHaveBeenCalledTimes(1);
    const written = writeMock.mock.calls[0]![0];
    expect(written).toMatch(/^@previews\/snap-\d+\.png $/);

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.message).toMatch(/Snapshot saved/i);
    expect(toasts[0]!.kind).toBe('success');
  });
});
