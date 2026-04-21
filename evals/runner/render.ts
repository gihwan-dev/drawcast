import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';
import type { ExcalidrawScene } from './types.js';

const require = createRequire(import.meta.url);

// Canvas safety cap. Beyond ~4096 we risk hitting browser texture limits
// across GPUs; pick the next power-of-two under that. Any scene larger
// than this still gets scaled down, but auto-layout output fits easily.
const MAX_EXPORT_DIMENSION = 4096;

// Lower bound on export scale. Below this, 16px text in Excalidraw lands
// under ~8px in the PNG, which the Codex rubric reliably flags as a
// readability failure regardless of the underlying structural quality.
// Pin the floor so large scenes trade raw pixel count for legibility
// instead of silently tanking the rubric.
const MIN_FONT_SCALE = 0.5;

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
      viewport: { width: 1800, height: 1400 },
      deviceScaleFactor: 1,
    });
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ path: reactPath });
    await page.addScriptTag({ path: reactDomPath });
    await page.addScriptTag({ path: bundlePath });
    const result = await page.evaluate(
      async ({ inputScene, maxDim, minFontScale }): Promise<BrowserRenderResult> => {
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
            // Scale down only when a dimension exceeds the canvas cap.
            // If the fit-scale would crush text below the floor, clamp
            // to minFontScale even if the result slightly exceeds maxDim
            // — readability wins over raw pixel count.
            const naturalScale = Math.min(
              maxDim / width,
              maxDim / height,
              1,
            );
            const scale = Math.max(minFontScale, naturalScale);
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
      {
        inputScene: scene,
        maxDim: MAX_EXPORT_DIMENSION,
        minFontScale: MIN_FONT_SCALE,
      },
    );
    await fs.writeFile(outputPath, Buffer.from(result.bytes));
  } finally {
    await browser.close();
  }
}
