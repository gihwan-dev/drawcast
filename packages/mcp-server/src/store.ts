// In-memory Scene state container for the MCP server.
//
// `SceneStore` owns the single source of truth for primitives, the active
// theme, user selection, and edit-locks. All mutation is synchronous so tool
// handlers can report success/failure deterministically; transports (stdio /
// SSE) observe change events and push updates to clients.
//
// See docs/05-mcp-server.md (Scene Store section).

import { EventEmitter } from 'node:events';
import type { Primitive, PrimitiveId, Scene, Theme } from '@drawcast/core';
import { sketchyTheme } from '@drawcast/core';

/**
 * Discriminated change event emitted on the `'change'` channel whenever the
 * store mutates. Transports subscribe via {@link SceneStore.onChange}.
 */
export interface SceneStoreChangeEvent {
  kind: 'upsert' | 'remove' | 'clear' | 'theme' | 'selection' | 'lock';
  /**
   * Primitive ids affected by this change, when applicable. Omitted for
   * `clear` and `theme` events because those touch everything or the global
   * theme reference.
   */
  primitiveIds?: PrimitiveId[];
}

/**
 * Thrown by {@link SceneStore.upsert}/{@link SceneStore.upsertMany} when the
 * caller attempts to mutate a primitive that the user has manually edited.
 * Tool handlers are expected to catch this and surface a structured MCP
 * error back to the model (see PR #9).
 */
export class SceneLockError extends Error {
  public readonly primitiveId: PrimitiveId;

  constructor(primitiveId: PrimitiveId) {
    super(
      `Primitive ${primitiveId} is locked (user edited). Unlock before mutating.`,
    );
    this.name = 'SceneLockError';
    this.primitiveId = primitiveId;
  }
}

export class SceneStore extends EventEmitter {
  private primitives = new Map<PrimitiveId, Primitive>();
  private theme: Theme = sketchyTheme;
  private selectionIds = new Set<PrimitiveId>();
  private editLocks = new Set<PrimitiveId>();

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Returns a snapshot of the current scene. The primitives map is cloned so
   * callers cannot mutate internal state through the returned reference.
   */
  getScene(): Scene {
    return {
      primitives: new Map(this.primitives),
      theme: this.theme,
    };
  }

  getPrimitive(id: PrimitiveId): Primitive | undefined {
    return this.primitives.get(id);
  }

  getAllPrimitives(): Primitive[] {
    return [...this.primitives.values()];
  }

  getTheme(): Theme {
    return this.theme;
  }

  getSelection(): readonly PrimitiveId[] {
    return [...this.selectionIds];
  }

  isLocked(id: PrimitiveId): boolean {
    return this.editLocks.has(id);
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  upsert(primitive: Primitive): void {
    if (this.editLocks.has(primitive.id)) {
      throw new SceneLockError(primitive.id);
    }
    this.primitives.set(primitive.id, primitive);
    this.emitChange({ kind: 'upsert', primitiveIds: [primitive.id] });
  }

  upsertMany(primitives: readonly Primitive[]): void {
    if (primitives.length === 0) {
      return;
    }
    // Fail atomically: if any primitive is locked, don't partially apply.
    for (const primitive of primitives) {
      if (this.editLocks.has(primitive.id)) {
        throw new SceneLockError(primitive.id);
      }
    }
    const ids: PrimitiveId[] = [];
    for (const primitive of primitives) {
      this.primitives.set(primitive.id, primitive);
      ids.push(primitive.id);
    }
    this.emitChange({ kind: 'upsert', primitiveIds: ids });
  }

  remove(id: PrimitiveId): boolean {
    const existed = this.primitives.delete(id);
    if (existed) {
      this.emitChange({ kind: 'remove', primitiveIds: [id] });
    }
    return existed;
  }

  clear(): void {
    this.primitives.clear();
    this.emitChange({ kind: 'clear' });
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.emitChange({ kind: 'theme' });
  }

  setSelection(ids: readonly PrimitiveId[]): void {
    this.selectionIds = new Set(ids);
    // Always emit, even if selection is identical — the UI may need to
    // re-highlight the same primitives.
    this.emitChange({ kind: 'selection', primitiveIds: [...this.selectionIds] });
  }

  // ---------------------------------------------------------------------------
  // Edit locks
  // ---------------------------------------------------------------------------

  lock(ids: readonly PrimitiveId[]): void {
    if (ids.length === 0) {
      return;
    }
    for (const id of ids) {
      this.editLocks.add(id);
    }
    this.emitChange({ kind: 'lock', primitiveIds: [...ids] });
  }

  unlock(ids: readonly PrimitiveId[]): void {
    if (ids.length === 0) {
      return;
    }
    for (const id of ids) {
      this.editLocks.delete(id);
    }
    this.emitChange({ kind: 'lock', primitiveIds: [...ids] });
  }

  unlockAll(): void {
    const ids = [...this.editLocks];
    this.editLocks.clear();
    this.emitChange({ kind: 'lock', primitiveIds: ids });
  }

  // ---------------------------------------------------------------------------
  // Listener helpers
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to change events. Returns an unsubscribe function — use it in
   * transport shutdown paths to avoid leaking listeners.
   */
  onChange(listener: (ev: SceneStoreChangeEvent) => void): () => void {
    this.on('change', listener);
    return () => {
      this.off('change', listener);
    };
  }

  // ---------------------------------------------------------------------------
  // Bulk replace (for future persistence rehydration)
  // ---------------------------------------------------------------------------

  /**
   * Replace the entire primitive map and (optionally) the theme in one
   * operation. Emits `clear` followed by `upsert` so transports can treat it
   * as a reset. Edit-locks and selection are left untouched.
   *
   * Used by persistence rehydration (PR #12). Callers must ensure no
   * replaced primitive conflicts with an existing edit-lock — this method
   * intentionally bypasses the lock check because it represents a fresh
   * load, not a tool-driven mutation.
   */
  replaceAll(primitives: readonly Primitive[], theme?: Theme): void {
    this.primitives.clear();
    if (theme !== undefined) {
      this.theme = theme;
    }
    this.emitChange({ kind: 'clear' });

    if (primitives.length === 0) {
      return;
    }
    const ids: PrimitiveId[] = [];
    for (const primitive of primitives) {
      this.primitives.set(primitive.id, primitive);
      ids.push(primitive.id);
    }
    this.emitChange({ kind: 'upsert', primitiveIds: ids });
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private emitChange(ev: SceneStoreChangeEvent): void {
    this.emit('change', ev);
  }
}
