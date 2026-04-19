// Upload channel tests. `saveUpload` is exercised directly (to pin down the
// Tauri invoke payload) and the ChatPanel drop/paste handlers are
// exercised end-to-end through the store + toast pipeline.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { saveUpload } from '../src/services/uploads.js';
import { ChatPanel } from '../src/panels/ChatPanel.js';
import { useChatStore } from '../src/store/chatStore.js';
import { useSessionStore } from '../src/store/sessionStore.js';
import { useSettingsStore } from '../src/store/settingsStore.js';
import { useToastStore } from '../src/store/toastStore.js';

const invokeMock = vi.mocked(invoke);

function resetStores(): void {
  act(() => {
    useChatStore.getState().reset();
    useSessionStore.setState({
      id: null,
      path: '/tmp/drawcast-session',
      current: null,
      list: [],
    });
    useSettingsStore.setState({
      themeMode: 'light',
      panelRatio: 0.4,
    });
    useToastStore.getState().clear();
  });
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

describe('ChatPanel drop handler', () => {
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

  it('routes dropped files through save_upload, shows a toast, and queues attachment chips', async () => {
    render(<ChatPanel />);
    const composer = screen.getByTestId('dc-chat-composer');

    const file1 = new File([new Uint8Array([1, 2])], 'a.png', {
      type: 'image/png',
    });
    const file2 = new File([new Uint8Array([3, 4])], 'b.png', {
      type: 'image/png',
    });

    await act(async () => {
      fireEvent.drop(composer, {
        dataTransfer: { files: [file1, file2], types: ['Files'] },
      });
    });

    // Both files should have reached the backend via save_upload.
    await waitFor(() => {
      const saveCalls = invokeMock.mock.calls.filter(
        (c) => c[0] === 'save_upload',
      );
      expect(saveCalls).toHaveLength(2);
    });

    const saveCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === 'save_upload',
    );
    const filenames = saveCalls.map(
      (c) => (c[1] as { filename: string }).filename,
    );
    expect(filenames).toEqual(['a.png', 'b.png']);

    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBeGreaterThanOrEqual(1);
    expect(toasts[0]!.kind).toBe('success');

    // Both files should also appear as attachment chips on the draft so
    // the user can see them before sending.
    await waitFor(() => {
      expect(useChatStore.getState().draft.attachments).toHaveLength(2);
    });
    const attachments = useChatStore.getState().draft.attachments;
    expect(attachments.map((a) => a.name)).toEqual(['a.png', 'b.png']);
    expect(attachments.every((a) => a.kind === 'image')).toBe(true);
  });
});

describe('ChatPanel paste handler', () => {
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
    render(<ChatPanel />);
    const composer = screen.getByTestId('dc-chat-composer');

    const pngBlob = new File([new Uint8Array([9, 9])], 'paste.png', {
      type: 'image/png',
    });

    await act(async () => {
      fireEvent.paste(composer, {
        clipboardData: {
          items: [
            {
              kind: 'file',
              type: 'image/png',
              getAsFile: () => pngBlob,
            },
          ],
        },
      });
    });

    await waitFor(() => {
      const saveCalls = invokeMock.mock.calls.filter(
        (c) => c[0] === 'save_upload',
      );
      expect(saveCalls).toHaveLength(1);
    });
    const saveCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === 'save_upload',
    );
    const filename = (saveCalls[0]![1] as { filename: string }).filename;
    // saveUploads sanitizes "paste.png" unchanged; we just check the name
    // survived the round-trip.
    expect(filename).toContain('paste');
    expect(filename.endsWith('.png')).toBe(true);
  });
});
