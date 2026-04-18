// Debounced Scene persistence.
//
// Writes `scene.excalidraw` (the full Excalidraw file envelope) whenever the
// SceneStore mutates, with a `customData.drawcastScene` sidecar that captures
// the original L2 primitives and the active theme name. Compiled Excalidraw
// JSON does not round-trip back to L2, so on reload we read only the sidecar
// and replay it through `store.replaceAll`. The `elements` portion of the
// envelope is authoritative for visual apps but ignored for MCP state
// reconstruction.
//
// Writes are atomic (tmp file + rename) and debounced so that bursts of
// mutations coalesce into a single IO roundtrip.
//
// See docs/05-mcp-server.md (PR #11, persistence section).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  compile,
  serializeAsExcalidrawFile,
  sketchyTheme,
  cleanTheme,
  monoTheme,
  type Primitive,
  type Theme,
} from '@drawcast/core';
import type { SceneStore } from './store.js';

export interface PersistenceOptions {
  /** Session directory. `scene.excalidraw` is written directly inside. */
  sessionPath: string;
  /**
   * Debounce window in milliseconds. Multiple mutations inside the window
   * collapse into a single save. Default: 500ms.
   */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 500;
const SCENE_FILE_NAME = 'scene.excalidraw';
const SIDECAR_VERSION = 1;

interface DrawcastSceneSidecar {
  version: number;
  primitives: Primitive[];
  theme: string;
}

/**
 * Resolves a theme name to a built-in Theme. Unknown names fall back to
 * `sketchyTheme` so a corrupted sidecar doesn't crash boot.
 */
function themeByName(name: string): Theme {
  switch (name) {
    case 'sketchy':
      return sketchyTheme;
    case 'clean':
      return cleanTheme;
    case 'mono':
      return monoTheme;
    default:
      return sketchyTheme;
  }
}

/**
 * Durable scene storage with debounced autosave + sidecar round-trip.
 *
 * Typical lifecycle:
 *
 * ```ts
 * const persistence = new ScenePersistence(store, { sessionPath });
 * await persistence.loadIfExists();
 * persistence.attach();
 * // ...
 * await persistence.flush();
 * persistence.dispose();
 * ```
 */
export class ScenePersistence {
  private readonly store: SceneStore;
  private readonly sessionPath: string;
  private readonly debounceMs: number;
  private pendingTimer: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;
  private savingPromise: Promise<void> | undefined;
  private disposed = false;

  constructor(store: SceneStore, opts: PersistenceOptions) {
    this.store = store;
    this.sessionPath = opts.sessionPath;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /** Returns the absolute scene file path inside the session directory. */
  get sceneFilePath(): string {
    return path.join(this.sessionPath, SCENE_FILE_NAME);
  }

  /**
   * Read `scene.excalidraw` if it exists and rehydrate the store via
   * `replaceAll`. No-op when the file is missing, unreadable, or lacks a
   * valid `customData.drawcastScene` sidecar.
   */
  async loadIfExists(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(this.sceneFilePath, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return;
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      // Corrupted JSON — treat as missing so the next save overwrites it.
      return;
    }

    const sidecar = extractSidecar(parsed);
    if (sidecar === undefined) {
      return;
    }

    this.store.replaceAll(sidecar.primitives, themeByName(sidecar.theme));
  }

  /**
   * Subscribe to store changes. Each change schedules a debounced save;
   * multiple rapid changes within the window collapse into one write.
   * Safe to call multiple times — subsequent calls are a no-op.
   */
  attach(): void {
    if (this.disposed) {
      throw new Error('ScenePersistence: cannot attach after dispose()');
    }
    if (this.unsubscribe !== undefined) {
      return;
    }
    this.unsubscribe = this.store.onChange(() => {
      this.scheduleSave();
    });
  }

  /** Force an immediate save and wait for the write to complete. */
  async flush(): Promise<void> {
    if (this.pendingTimer !== undefined) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = undefined;
    }
    await this.save();
  }

  /**
   * Detach listeners and cancel any pending debounced save. Idempotent.
   * Does NOT flush; call `flush()` first if you want to persist before
   * exit.
   */
  dispose(): void {
    this.disposed = true;
    if (this.unsubscribe !== undefined) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    if (this.pendingTimer !== undefined) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private scheduleSave(): void {
    if (this.disposed) {
      return;
    }
    if (this.pendingTimer !== undefined) {
      clearTimeout(this.pendingTimer);
    }
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = undefined;
      // Deliberately fire-and-forget: save() already swallows errors via the
      // logging path below. We must not throw synchronously inside a store
      // change callback.
      void this.save().catch((err) => {
        process.stderr.write(
          `[drawcast-mcp] persistence save failed: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
      });
    }, this.debounceMs);
    // Unref so a pending save doesn't hold the event loop open.
    this.pendingTimer.unref?.();
  }

  private async save(): Promise<void> {
    // Chain saves so concurrent calls never race the same file.
    const prior = this.savingPromise ?? Promise.resolve();
    const next = prior.then(() => this.writeSnapshot());
    this.savingPromise = next.catch(() => undefined).then(() => undefined);
    await next;
  }

  private async writeSnapshot(): Promise<void> {
    const snapshot = this.store.getScene();
    const primitives = [...snapshot.primitives.values()];
    const sidecar: DrawcastSceneSidecar = {
      version: SIDECAR_VERSION,
      primitives,
      theme: snapshot.theme.name,
    };
    const result = compile(snapshot);
    const envelope = serializeAsExcalidrawFile(result, {
      customData: { drawcastScene: sidecar as unknown as Record<string, unknown> },
    });
    const payload = JSON.stringify(envelope, null, 2);

    await fs.mkdir(this.sessionPath, { recursive: true });
    const targetPath = this.sceneFilePath;
    const tmpPath = `${targetPath}.${randomUUID()}.tmp`;

    try {
      await fs.writeFile(tmpPath, payload, 'utf8');
      await fs.rename(tmpPath, targetPath);
    } catch (err) {
      // Best-effort cleanup of the tmp file; swallow the unlink error.
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      throw err;
    }
  }
}

/**
 * Validate and return the `customData.drawcastScene` sidecar, or `undefined`
 * when it is missing/malformed. Keeps the loader tolerant of unrelated
 * `customData` keys that other Excalidraw consumers might have added.
 */
function extractSidecar(parsed: unknown): DrawcastSceneSidecar | undefined {
  if (parsed === null || typeof parsed !== 'object') {
    return undefined;
  }
  const envelope = parsed as { customData?: unknown };
  if (envelope.customData === null || typeof envelope.customData !== 'object') {
    return undefined;
  }
  const customData = envelope.customData as { drawcastScene?: unknown };
  const sidecar = customData.drawcastScene;
  if (sidecar === null || typeof sidecar !== 'object') {
    return undefined;
  }
  const candidate = sidecar as Partial<DrawcastSceneSidecar>;
  if (typeof candidate.version !== 'number') {
    return undefined;
  }
  if (!Array.isArray(candidate.primitives)) {
    return undefined;
  }
  if (typeof candidate.theme !== 'string') {
    return undefined;
  }
  return {
    version: candidate.version,
    primitives: candidate.primitives as Primitive[],
    theme: candidate.theme,
  };
}
