// PR #19 toolbar tests — Copy PNG / Copy Excalidraw / Export to file.
//
// The Rust commands (`clipboard_write_png`, `clipboard_write_text`,
// `save_export_bytes`) and the `@tauri-apps/plugin-dialog` `save` helper
// are both mocked via the global `vi.mock` wired in `test/setup.ts` /
// inline below. The mocks let us assert on the exact arg shape the
// frontend sends, which is the actual contract at stake here.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types';
import type { LabelBox, PrimitiveId } from '@drawcast/core';
import {
  copyExcalidraw,
  copyPng,
  exportToFile,
} from '../src/services/copyExport.js';
import { CanvasToolbar } from '../src/components/CanvasToolbar.js';
import { useCanvasStore } from '../src/store/canvasStore.js';
import { useSceneStore } from '../src/store/sceneStore.js';
import { useToastStore } from '../src/store/toastStore.js';
import {
  resetExcalidrawMock,
  setNextExportBlob,
} from './mocks/excalidraw.js';

// `@tauri-apps/plugin-dialog` isn't stubbed in the global setup — do it here
// so the save() call the exportToFile service makes is observable.
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(async () => null),
  open: vi.fn(async () => null),
}));

const invokeMock = vi.mocked(invoke);
const saveMock = vi.mocked(save);

/** Small stub approximating `ExcalidrawImperativeAPI` for the services. */
function makeApi(): ExcalidrawImperativeAPI {
  const stub = {
    getSceneElements: () => [],
    getAppState: () => ({ viewBackgroundColor: '#ffffff' }),
    getFiles: () => ({}),
    updateScene: () => {},
    addFiles: () => {},
  };
  return stub as unknown as ExcalidrawImperativeAPI;
}

/** A single L2 primitive so `compile()` produces at least one element. */
function buildScenePrimitives(): readonly LabelBox[] {
  return [
    {
      id: 'p1' as PrimitiveId,
      kind: 'labelBox',
      shape: 'rectangle',
      at: [0, 0],
      text: 'hello',
    },
  ];
}

function primeSceneStore(): void {
  act(() => {
    useSceneStore.setState({
      primitives: buildScenePrimitives(),
      theme: 'sketchy',
      selection: [],
      locked: [],
    });
  });
}

describe('copyPng', () => {
  beforeEach(() => {
    resetExcalidrawMock();
    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => null);
  });

  afterEach(() => {
    invokeMock.mockReset();
  });

  it('exports the canvas to PNG and writes the bytes via clipboard_write_png', async () => {
    setNextExportBlob(
      new Blob([new Uint8Array([0xde, 0xad, 0xbe, 0xef])], {
        type: 'image/png',
      }),
    );
    await copyPng(makeApi());

    const calls = invokeMock.mock.calls.filter(
      (c) => c[0] === 'clipboard_write_png',
    );
    expect(calls).toHaveLength(1);
    const args = calls[0]![1] as { data: number[] };
    expect(args.data).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });
});

describe('copyExcalidraw', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => null);
  });

  afterEach(() => {
    invokeMock.mockReset();
  });

  it('serializes the scene as the excalidraw/clipboard envelope and writes plain text', async () => {
    await copyExcalidraw(makeApi(), {
      primitives: buildScenePrimitives(),
      theme: 'sketchy',
    });

    const calls = invokeMock.mock.calls.filter(
      (c) => c[0] === 'clipboard_write_text',
    );
    expect(calls).toHaveLength(1);
    const { text } = calls[0]![1] as { text: string };
    const parsed = JSON.parse(text) as {
      type: string;
      elements: readonly unknown[];
    };
    expect(parsed.type).toBe('excalidraw/clipboard');
    expect(parsed.elements.length).toBeGreaterThan(0);
  });
});

describe('exportToFile', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    saveMock.mockReset();
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'save_export_bytes') {
        const payload = args as { path: string };
        return payload.path;
      }
      return null;
    });
  });

  afterEach(() => {
    invokeMock.mockReset();
    saveMock.mockReset();
  });

  it('writes the excalidraw envelope to the user-chosen path', async () => {
    saveMock.mockResolvedValueOnce('/tmp/my-scene.excalidraw');

    const saved = await exportToFile(
      makeApi(),
      { primitives: buildScenePrimitives(), theme: 'sketchy' },
      { format: 'excalidraw' },
    );

    expect(saved).toBe('/tmp/my-scene.excalidraw');
    expect(saveMock).toHaveBeenCalledTimes(1);

    const writeCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === 'save_export_bytes',
    );
    expect(writeCalls).toHaveLength(1);
    const payload = writeCalls[0]![1] as { path: string; data: number[] };
    expect(payload.path).toBe('/tmp/my-scene.excalidraw');

    // Reconstruct the payload bytes and ensure it parses back into an
    // excalidraw envelope (not a clipboard one, not markdown).
    const text = new TextDecoder().decode(new Uint8Array(payload.data));
    const parsed = JSON.parse(text) as { type: string; version: number };
    expect(parsed.type).toBe('excalidraw');
    expect(parsed.version).toBe(2);
  });

  it('returns null and issues no write when the user cancels the dialog', async () => {
    saveMock.mockResolvedValueOnce(null);

    const result = await exportToFile(
      makeApi(),
      { primitives: buildScenePrimitives(), theme: 'sketchy' },
      { format: 'excalidraw' },
    );

    expect(result).toBeNull();
    expect(
      invokeMock.mock.calls.filter((c) => c[0] === 'save_export_bytes'),
    ).toHaveLength(0);
  });
});

describe('CanvasToolbar component', () => {
  beforeEach(() => {
    resetExcalidrawMock();
    invokeMock.mockReset();
    saveMock.mockReset();
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'save_export_bytes') {
        const payload = args as { path: string };
        return payload.path;
      }
      return null;
    });
    saveMock.mockResolvedValue(null);
    primeSceneStore();
    act(() => {
      useCanvasStore.getState().setApi(makeApi());
      useToastStore.getState().clear();
    });
  });

  afterEach(() => {
    invokeMock.mockReset();
    saveMock.mockReset();
    act(() => {
      useCanvasStore.getState().setApi(null);
    });
  });

  it('renders three action buttons and wires each to the right service', async () => {
    render(<CanvasToolbar />);

    const copyPngBtn = screen.getByTestId('dc-toolbar-copy-png');
    const copyExcalidrawBtn = screen.getByTestId('dc-toolbar-copy-excalidraw');
    const exportBtn = screen.getByTestId('dc-toolbar-export');
    expect(copyPngBtn).toBeInTheDocument();
    expect(copyExcalidrawBtn).toBeInTheDocument();
    expect(exportBtn).toBeInTheDocument();

    setNextExportBlob(
      new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    );

    await act(async () => {
      fireEvent.click(copyPngBtn);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(
      invokeMock.mock.calls.filter((c) => c[0] === 'clipboard_write_png'),
    ).toHaveLength(1);

    await act(async () => {
      fireEvent.click(copyExcalidrawBtn);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(
      invokeMock.mock.calls.filter((c) => c[0] === 'clipboard_write_text'),
    ).toHaveLength(1);

    saveMock.mockResolvedValueOnce('/tmp/scene.excalidraw');
    await act(async () => {
      fireEvent.click(exportBtn);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(saveMock).toHaveBeenCalled();
    expect(
      invokeMock.mock.calls.filter((c) => c[0] === 'save_export_bytes'),
    ).toHaveLength(1);
  });
});
