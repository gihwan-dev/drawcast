import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

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
