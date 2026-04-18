// PR #16 upload channel tests. We exercise `saveUpload` directly (to pin
// down the invoke payload shape) and the `TerminalPanel`'s drop + paste
// handlers end-to-end through the store+toast pipeline.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { saveUpload } from '../src/services/uploads.js';
import {
  TerminalPanel,
  __resetActiveTerminalForTests,
} from '../src/panels/TerminalPanel.js';
import { useCliStore } from '../src/store/cliStore.js';
import { useSessionStore } from '../src/store/sessionStore.js';
import { useSettingsStore } from '../src/store/settingsStore.js';
import { useToastStore } from '../src/store/toastStore.js';

// Reuse the CLI service mock shape from terminal.test.tsx so the empty state
// has the minimum Tauri-side stubs it needs to mount.
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

const invokeMock = vi.mocked(invoke);

function resetStores(): void {
  act(() => {
    useCliStore.setState({ running: false, which: null });
    useSessionStore.setState({
      id: null,
      path: '/tmp/drawcast-session',
      current: null,
      list: [],
    });
    useSettingsStore.setState({
      themeMode: 'light',
      cliChoice: null,
      panelRatio: 0.4,
    });
    useToastStore.getState().clear();
  });
  __resetActiveTerminalForTests();
}

describe('saveUpload', () => {
  beforeEach(() => {
    resetStores();
    invokeMock.mockReset();
  });

  afterEach(() => {
    invokeMock.mockReset();
  });

  it('invokes save_upload with the session path, filename, and byte array', async () => {
    invokeMock.mockResolvedValueOnce('/tmp/drawcast-session/uploads/pic.png');
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const result = await saveUpload('pic.png', bytes.buffer);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = invokeMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(cmd).toBe('save_upload');
    expect(args['sessionPath']).toBe('/tmp/drawcast-session');
    expect(args['filename']).toBe('pic.png');
    expect(args['data']).toEqual([1, 2, 3, 4]);
    expect(result.fileName).toBe('pic.png');
    expect(result.path).toBe('/tmp/drawcast-session/uploads/pic.png');
  });
});

describe('TerminalPanel drop handler', () => {
  beforeEach(() => {
    resetStores();
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'save_upload') {
        const payload = args as { filename: string };
        return `/tmp/drawcast-session/uploads/${payload.filename}`;
      }
      return null;
    });
  });

  afterEach(() => {
    invokeMock.mockReset();
  });

  it('routes dropped files through save_upload and shows a toast', async () => {
    render(<TerminalPanel />);
    const layer = screen.getByTestId('dc-terminal-upload-layer');

    const file1 = new File([new Uint8Array([1, 2])], 'a.png', {
      type: 'image/png',
    });
    const file2 = new File([new Uint8Array([3, 4])], 'b.png', {
      type: 'image/png',
    });

    await act(async () => {
      fireEvent.drop(layer, {
        dataTransfer: { files: [file1, file2], types: ['Files'] },
      });
      // The drop handler is async (arrayBuffer + invoke); flush the
      // microtask queue so its promise chain resolves before assertions.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Both files should have produced an invoke call, and a single success
    // toast ("Saved 2 files") should be queued.
    const saveCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === 'save_upload',
    );
    expect(saveCalls).toHaveLength(2);
    const filenames = saveCalls.map(
      (c) => (c[1] as { filename: string }).filename,
    );
    expect(filenames).toEqual(['a.png', 'b.png']);

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.message).toContain('Saved 2 files');
    expect(toasts[0]!.kind).toBe('success');
  });
});

describe('TerminalPanel paste handler', () => {
  beforeEach(() => {
    resetStores();
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'save_upload') {
        const payload = args as { filename: string };
        return `/tmp/drawcast-session/uploads/${payload.filename}`;
      }
      return null;
    });
  });

  afterEach(() => {
    invokeMock.mockReset();
  });

  it('saves image clipboard items as paste-<ts>.<ext>', async () => {
    render(<TerminalPanel />);
    const layer = screen.getByTestId('dc-terminal-upload-layer');

    const pngBlob = new File([new Uint8Array([9, 9])], 'ignored.png', {
      type: 'image/png',
    });

    // React's clipboard event wrapper lets us pass a fake DataTransferItemList
    // via the `clipboardData` init option.
    await act(async () => {
      fireEvent.paste(layer, {
        clipboardData: {
          items: [
            {
              type: 'image/png',
              getAsFile: () => pngBlob,
            },
          ],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const saveCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === 'save_upload',
    );
    expect(saveCalls).toHaveLength(1);
    const filename = (saveCalls[0]![1] as { filename: string }).filename;
    expect(filename).toMatch(/^paste-\d+-0\.png$/);
  });
});
