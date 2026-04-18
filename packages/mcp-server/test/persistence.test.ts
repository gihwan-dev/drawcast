// Persistence tests.
//
// Exercises the debounced autosave + sidecar round-trip. All tests run in
// their own temp directory so we never touch the real home directory.

import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { LabelBox, PrimitiveId } from '@drawcast/core';
import { cleanTheme, sketchyTheme } from '@drawcast/core';
import { SceneStore } from '../src/store.js';
import { ScenePersistence } from '../src/persistence.js';

async function tempDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `drawcast-persist-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function makeBox(id: string, text?: string): LabelBox {
  return {
    kind: 'labelBox',
    id: id as PrimitiveId,
    shape: 'rectangle',
    at: [0, 0],
    ...(text !== undefined && { text }),
  };
}

async function waitMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('ScenePersistence.loadIfExists', () => {
  it('no-ops when the file does not exist', async () => {
    const dir = await tempDir();
    const store = new SceneStore();
    const p = new ScenePersistence(store, { sessionPath: dir });
    await expect(p.loadIfExists()).resolves.toBeUndefined();
    expect(store.getAllPrimitives()).toEqual([]);
  });

  it('restores primitives + theme from the sidecar', async () => {
    const dir = await tempDir();
    // Write a matching sidecar file first.
    const initial = new SceneStore();
    initial.upsert(makeBox('a', 'Hello'));
    initial.setTheme(cleanTheme);
    const writer = new ScenePersistence(initial, { sessionPath: dir });
    await writer.flush();

    const store = new SceneStore();
    const p = new ScenePersistence(store, { sessionPath: dir });
    await p.loadIfExists();

    const restored = store.getAllPrimitives();
    expect(restored).toHaveLength(1);
    const first = restored[0];
    expect(first).toBeDefined();
    expect(first!.kind).toBe('labelBox');
    if (first!.kind === 'labelBox') {
      expect(first!.text).toBe('Hello');
    }
    expect(store.getTheme().name).toBe('clean');
  });
});

describe('ScenePersistence.attach', () => {
  it('writes to disk after the debounce window', async () => {
    const dir = await tempDir();
    const store = new SceneStore();
    const p = new ScenePersistence(store, {
      sessionPath: dir,
      debounceMs: 20,
    });
    p.attach();

    store.upsert(makeBox('a', 'Hi'));
    await waitMs(80);

    const raw = await fs.readFile(path.join(dir, 'scene.excalidraw'), 'utf8');
    const parsed = JSON.parse(raw) as {
      customData?: { drawcastScene?: { primitives: unknown[] } };
    };
    expect(parsed.customData?.drawcastScene?.primitives).toHaveLength(1);
    p.dispose();
  });

  it('coalesces rapid mutations into a single write', async () => {
    const dir = await tempDir();
    const store = new SceneStore();
    const p = new ScenePersistence(store, {
      sessionPath: dir,
      debounceMs: 30,
    });
    p.attach();

    // Trigger 10 mutations inside the debounce window.
    for (let i = 0; i < 10; i++) {
      store.upsert(makeBox(`node-${i}`));
    }
    await waitMs(100);

    const target = path.join(dir, 'scene.excalidraw');
    const stat1 = await fs.stat(target);
    const raw = await fs.readFile(target, 'utf8');
    const parsed = JSON.parse(raw) as {
      customData?: { drawcastScene?: { primitives: unknown[] } };
    };
    expect(parsed.customData?.drawcastScene?.primitives).toHaveLength(10);
    // Brief wait then assert the file was not rewritten a second time.
    await waitMs(50);
    const stat2 = await fs.stat(target);
    expect(stat2.mtimeMs).toBe(stat1.mtimeMs);

    p.dispose();
  });
});

describe('ScenePersistence.flush', () => {
  it('forces an immediate save even before debounce expires', async () => {
    const dir = await tempDir();
    const store = new SceneStore();
    const p = new ScenePersistence(store, {
      sessionPath: dir,
      debounceMs: 5_000,
    });
    p.attach();

    store.upsert(makeBox('a'));
    // Confirm the file does NOT exist yet (timer hasn't fired).
    await expect(
      fs.access(path.join(dir, 'scene.excalidraw')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    await p.flush();
    const raw = await fs.readFile(path.join(dir, 'scene.excalidraw'), 'utf8');
    expect(raw).toContain('drawcastScene');
    p.dispose();
  });
});

describe('ScenePersistence.dispose', () => {
  it('cancels any pending save', async () => {
    const dir = await tempDir();
    const store = new SceneStore();
    const p = new ScenePersistence(store, {
      sessionPath: dir,
      debounceMs: 30,
    });
    p.attach();

    store.upsert(makeBox('a'));
    p.dispose();
    await waitMs(80);

    await expect(
      fs.access(path.join(dir, 'scene.excalidraw')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('ScenePersistence theme resolution', () => {
  it('defaults to sketchy when the sidecar is absent', async () => {
    const dir = await tempDir();
    // Write a valid envelope without the sidecar.
    const envelopePath = path.join(dir, 'scene.excalidraw');
    await fs.writeFile(
      envelopePath,
      JSON.stringify({
        type: 'excalidraw',
        version: 2,
        source: 'x',
        elements: [],
        appState: { viewBackgroundColor: '#ffffff', gridSize: null },
        files: {},
      }),
    );
    const store = new SceneStore();
    const p = new ScenePersistence(store, { sessionPath: dir });
    await p.loadIfExists();
    // Sidecar-less envelope -> no replace, default sketchy theme remains.
    expect(store.getAllPrimitives()).toEqual([]);
    expect(store.getTheme().name).toBe(sketchyTheme.name);
  });
});
