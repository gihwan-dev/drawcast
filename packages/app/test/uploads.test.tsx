// Upload channel tests. `saveUpload` is exercised directly (to pin down the
// Tauri invoke payload) and the ChatPanel drop/paste/picker handlers are
// exercised end-to-end through the store + toast pipeline. Mixed-MIME and
// real-fixture cases live below the toy-byte cases so the read-time cost
// only kicks in when the per-MIME branches actually need to be checked.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { saveUpload } from '../src/services/uploads.js';
import { fileToContentBlocks } from '../src/services/chat.js';
import { ChatPanel } from '../src/panels/ChatPanel.js';
import { useChatStore } from '../src/store/chatStore.js';
import { useSessionStore } from '../src/store/sessionStore.js';
import { useSettingsStore } from '../src/store/settingsStore.js';
import { useToastStore } from '../src/store/toastStore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures/uploads');

function fixtureFile(name: string, mime: string): File {
  const bytes = readFileSync(resolve(FIXTURES_DIR, name));
  return new File([new Uint8Array(bytes)], name, { type: mime });
}

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

// ---------------------------------------------------------------------------
// fileToContentBlocks against real fixture bytes.
//
// The PNG / PDF / Markdown branches each take their own code path and emit
// a distinct block shape. Round-tripping real fixture bytes guarantees the
// base64 encoding survives a real binary payload (no UTF-8 corruption) and
// that text files keep the `# filename` header the model relies on.

describe('fileToContentBlocks (real fixtures)', () => {
  it('encodes a PNG into an image block whose base64 starts with the PNG magic', async () => {
    const file = fixtureFile('before-export.png', 'image/png');

    const blocks = await fileToContentBlocks(file);

    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.type).toBe('image');
    if (block.type !== 'image') throw new Error('unreachable');
    expect(block.source.type).toBe('base64');
    expect(block.source.media_type).toBe('image/png');
    // base64('\x89PNG') === 'iVBORw0K...' — the PNG signature must survive.
    expect(block.source.data.startsWith('iVBOR')).toBe(true);
    expect(block.source.data.length).toBeGreaterThan(1000);
  });

  it('encodes a PDF into a document block whose base64 starts with the PDF magic', async () => {
    const file = fixtureFile('playbook-3pages.pdf', 'application/pdf');

    const blocks = await fileToContentBlocks(file);

    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.type).toBe('document');
    if (block.type !== 'document') throw new Error('unreachable');
    expect(block.source.media_type).toBe('application/pdf');
    // base64('%PDF-') === 'JVBERi0' — fail loudly if the bytes were
    // mangled (e.g. someone re-introduces a TextDecoder pass on PDFs).
    expect(block.source.data.startsWith('JVBERi0')).toBe(true);
  });

  it('detects a .pdf extension even when the browser leaves the MIME blank', async () => {
    const file = fixtureFile('playbook-3pages.pdf', '');

    const blocks = await fileToContentBlocks(file);

    expect(blocks[0]?.type).toBe('document');
  });

  it('wraps a markdown file in a text block with the filename header', async () => {
    const file = fixtureFile('team-ai-rules-memo.md', 'text/markdown');

    const blocks = await fileToContentBlocks(file);

    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.type).toBe('text');
    if (block.type !== 'text') throw new Error('unreachable');
    expect(block.text.startsWith('# team-ai-rules-memo.md\n\n')).toBe(true);
    // Sanity: the actual content (Korean memo) survives the UTF-8 decode.
    expect(block.text).toContain('CLAUDE.md');
  });
});

// ---------------------------------------------------------------------------
// Mixed-type drop covers the integration we actually ship: a user grabs
// an image, a PDF, and a markdown file from Finder and drops them all at
// once. Each must reach the backend, each must surface as a chip with the
// correct kind, and the chip count must match the file count.

describe('ChatPanel multi-type drop', () => {
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

  it('routes PNG + PDF + Markdown through save_upload and renders one chip per kind', async () => {
    render(<ChatPanel />);
    const composer = screen.getByTestId('dc-chat-composer');

    const pngFile = fixtureFile('before-export.png', 'image/png');
    const pdfFile = fixtureFile('playbook-3pages.pdf', 'application/pdf');
    const mdFile = fixtureFile('team-ai-rules-memo.md', 'text/markdown');

    await act(async () => {
      fireEvent.drop(composer, {
        dataTransfer: {
          files: [pngFile, pdfFile, mdFile],
          types: ['Files'],
        },
      });
    });

    // All three should land at the backend in input order.
    await waitFor(() => {
      const saveCalls = invokeMock.mock.calls.filter(
        (c) => c[0] === 'save_upload',
      );
      expect(saveCalls).toHaveLength(3);
    });
    const saveCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === 'save_upload',
    );
    expect(
      saveCalls.map((c) => (c[1] as { filename: string }).filename),
    ).toEqual([
      'before-export.png',
      'playbook-3pages.pdf',
      'team-ai-rules-memo.md',
    ]);

    // And each must surface in the draft with the correct kind so the
    // chip renders the right icon + label.
    await waitFor(() => {
      expect(useChatStore.getState().draft.attachments).toHaveLength(3);
    });
    const kinds = useChatStore
      .getState()
      .draft.attachments.map((a) => a.kind);
    expect(kinds).toEqual(['image', 'document', 'text']);

    // The DOM must render one chip per attachment.
    const chips = screen.getAllByTestId('dc-chat-chip');
    expect(chips).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// File picker flow — third entry point alongside drag-drop and paste. The
// hidden <input type="file"> drives `onFilePicker`; firing `change` on
// it stands in for the OS file dialog completing.

describe('ChatPanel file picker', () => {
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

  it('routes picker-selected files through ingest like drop and paste do', async () => {
    const { container } = render(<ChatPanel />);
    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();

    const pngFile = fixtureFile('before-export.png', 'image/png');
    const mdFile = fixtureFile('team-ai-rules-memo.md', 'text/markdown');

    // jsdom won't let us assign to `files` via a normal setter, and a
    // plain array fails on `.item(i)`. Build a FileList-shaped object.
    const fakeFileList: FileList = Object.assign([pngFile, mdFile], {
      item(i: number): File | null {
        return [pngFile, mdFile][i] ?? null;
      },
    }) as unknown as FileList;
    Object.defineProperty(fileInput!, 'files', {
      configurable: true,
      value: fakeFileList,
    });

    await act(async () => {
      fireEvent.change(fileInput!);
    });

    await waitFor(() => {
      expect(useChatStore.getState().draft.attachments).toHaveLength(2);
    });
    const attachments = useChatStore.getState().draft.attachments;
    expect(attachments.map((a) => a.name)).toEqual([
      'before-export.png',
      'team-ai-rules-memo.md',
    ]);
    expect(attachments.map((a) => a.kind)).toEqual(['image', 'text']);

    // After ingest, the input must be cleared so picking the same file
    // a second time still fires `change`.
    expect(fileInput!.value).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Chip remove — once attached, the user must be able to drop a single
// file off the draft without nuking the others.

describe('ChatPanel attachment chip remove', () => {
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

  it('removes the targeted chip and leaves the others intact', async () => {
    render(<ChatPanel />);
    const composer = screen.getByTestId('dc-chat-composer');

    const png = fixtureFile('before-export.png', 'image/png');
    const md = fixtureFile('team-ai-rules-memo.md', 'text/markdown');

    await act(async () => {
      fireEvent.drop(composer, {
        dataTransfer: { files: [png, md], types: ['Files'] },
      });
    });

    await waitFor(() => {
      expect(useChatStore.getState().draft.attachments).toHaveLength(2);
    });

    // Click the X on the PNG chip.
    const removeBtn = screen.getByLabelText('Remove before-export.png');
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    const remaining = useChatStore.getState().draft.attachments;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.name).toBe('team-ai-rules-memo.md');

    // And the DOM must reflect the removal.
    expect(screen.getAllByTestId('dc-chat-chip')).toHaveLength(1);
  });
});
