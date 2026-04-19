/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: {
    // @excalidraw/excalidraw 0.17.x bundle references `process.env.IS_PREACT`;
    // without this alias the Tauri webview throws ReferenceError on first load.
    'process.env.IS_PREACT': JSON.stringify('false'),
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
