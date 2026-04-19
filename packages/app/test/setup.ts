import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// xterm addons are UMD bundles that reference `self` — undefined in jsdom.
if (typeof globalThis.self === 'undefined') {
  (globalThis as unknown as { self: typeof globalThis }).self = globalThis;
}

// jsdom lacks ResizeObserver; TerminalPanel + CanvasPanel observe layout.
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
}

// TerminalPanel dynamically imports xterm; mock the whole module so jsdom
// never tries to evaluate its canvas-dependent code paths.
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    paste: vi.fn(),
    dispose: vi.fn(),
    loadAddon: vi.fn(),
    focus: vi.fn(),
    get cols() { return 80; },
    get rows() { return 24; },
  })),
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    dispose: vi.fn(),
  })),
}));

// jsdom doesn't have matchMedia — a few React components probe it.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Tauri event bus isn't available in jsdom. Stub the two entrypoints the
// sidecar bridge relies on so `App` can mount without crashing.
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => null),
}));

// @excalidraw/excalidraw requires Path2D and a live CSS pipeline, neither
// of which jsdom ships. Every test mounts its own lightweight stand-in —
// see `test/mocks/excalidraw.tsx`.
vi.mock('@excalidraw/excalidraw', () => import('./mocks/excalidraw.js'));

// jsdom's File/Blob don't always expose `.arrayBuffer()`. Polyfill it so
// upload tests can read dropped/pasted bytes.
if (
  typeof Blob !== 'undefined' &&
  typeof Blob.prototype.arrayBuffer !== 'function'
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Blob.prototype as any).arrayBuffer = function (): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const r = reader.result;
        if (r instanceof ArrayBuffer) resolve(r);
        else reject(new Error('not an ArrayBuffer'));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this as unknown as Blob);
    });
  };
}
