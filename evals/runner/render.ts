import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';
import type { ExcalidrawScene } from './types.js';

const require = createRequire(import.meta.url);
const MAX_RENDER_WIDTH = 1800;

function resolvePackageFile(pkgName: string, subPath: string): string {
  const pkgJson = require.resolve(`${pkgName}/package.json`);
  return path.join(path.dirname(pkgJson), subPath);
}

interface BrowserRenderResult {
  bytes: number[];
}

export async function renderSceneToPng(
  scene: ExcalidrawScene,
  outputPath: string,
): Promise<void> {
  const reactPath = resolvePackageFile('react', 'umd/react.production.min.js');
  const reactDomPath = resolvePackageFile(
    'react-dom',
    'umd/react-dom.production.min.js',
  );
  const bundlePath = resolvePackageFile(
    '@excalidraw/excalidraw',
    'dist/excalidraw.production.min.js',
  );
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: MAX_RENDER_WIDTH, height: 1400 },
      deviceScaleFactor: 1,
    });
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ path: reactPath });
    await page.addScriptTag({ path: reactDomPath });
    await page.addScriptTag({ path: bundlePath });
    const result = await page.evaluate(
      async ({ inputScene, maxWidth }): Promise<BrowserRenderResult> => {
        const browserWindow = window as unknown as {
          ExcalidrawLib?: {
            exportToBlob?: (options: Record<string, unknown>) => Promise<Blob>;
          };
        };
        const exportToBlob = browserWindow.ExcalidrawLib?.exportToBlob;
        if (exportToBlob === undefined) {
          throw new Error('Excalidraw exportToBlob is unavailable');
        }
        const sceneRecord = inputScene as ExcalidrawScene;
        const appState = sceneRecord.appState ?? {};
        const blob = await exportToBlob({
          elements: sceneRecord.elements,
          appState: {
            ...appState,
            viewBackgroundColor:
              typeof appState.viewBackgroundColor === 'string'
                ? appState.viewBackgroundColor
                : '#ffffff',
            exportBackground: true,
          },
          files: sceneRecord.files ?? {},
          mimeType: 'image/png',
          quality: 1,
          exportPadding: 48,
          getDimensions: (width: number, height: number) => {
            const scale = width > maxWidth ? maxWidth / width : 1;
            return {
              width: Math.ceil(width * scale),
              height: Math.ceil(height * scale),
              scale,
            };
          },
        });
        return {
          bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
        };
      },
      { inputScene: scene, maxWidth: MAX_RENDER_WIDTH },
    );
    await fs.writeFile(outputPath, Buffer.from(result.bytes));
  } finally {
    await browser.close();
  }
}
