// Unit tests for SceneStore — the in-memory state container that owns
// primitives, theme, selection, and edit-locks for the MCP server.

import { describe, expect, it, vi } from 'vitest';
import type {
  LabelBox,
  Primitive,
  PrimitiveId,
  Sticky,
  Theme,
} from '@drawcast/core';
import { sketchyTheme } from '@drawcast/core';
import {
  SceneLockError,
  SceneStore,
  type SceneStoreChangeEvent,
} from '../src/store.js';

function id(raw: string): PrimitiveId {
  return raw as PrimitiveId;
}

function makeBox(idStr: string, text = 'hello'): LabelBox {
  return {
    kind: 'labelBox',
    id: id(idStr),
    text,
    shape: 'rectangle',
    at: [0, 0],
  };
}

function makeSticky(idStr: string, text = 'note'): Sticky {
  return {
    kind: 'sticky',
    id: id(idStr),
    text,
    at: [10, 20],
  };
}

describe('SceneStore', () => {
  it('starts empty', () => {
    const store = new SceneStore();
    expect(store.getAllPrimitives()).toEqual([]);
    expect(store.getSelection()).toEqual([]);
    expect(store.getTheme()).toBe(sketchyTheme);
  });

  it('upsert adds a primitive and getPrimitive returns it', () => {
    const store = new SceneStore();
    const box = makeBox('a');
    store.upsert(box);
    expect(store.getPrimitive(id('a'))).toBe(box);
    expect(store.getAllPrimitives()).toHaveLength(1);
  });

  it('upsert with the same id overwrites in-place', () => {
    const store = new SceneStore();
    store.upsert(makeBox('a', 'first'));
    store.upsert(makeBox('a', 'second'));
    expect(store.getAllPrimitives()).toHaveLength(1);
    const current = store.getPrimitive(id('a')) as LabelBox;
    expect(current.text).toBe('second');
  });

  it('remove returns true for existing ids and clears them', () => {
    const store = new SceneStore();
    store.upsert(makeBox('a'));
    expect(store.remove(id('a'))).toBe(true);
    expect(store.getPrimitive(id('a'))).toBeUndefined();
    expect(store.getAllPrimitives()).toHaveLength(0);
  });

  it('remove returns false and emits no event for missing ids', () => {
    const store = new SceneStore();
    const listener = vi.fn();
    store.onChange(listener);
    expect(store.remove(id('missing'))).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('clear drops all primitives', () => {
    const store = new SceneStore();
    store.upsert(makeBox('a'));
    store.upsert(makeBox('b'));
    store.clear();
    expect(store.getAllPrimitives()).toHaveLength(0);
  });

  it('onChange fires on upsert with the right event shape', () => {
    const store = new SceneStore();
    const events: SceneStoreChangeEvent[] = [];
    store.onChange((ev) => events.push(ev));
    store.upsert(makeBox('a'));
    expect(events).toEqual([
      { kind: 'upsert', primitiveIds: [id('a')] },
    ]);
  });

  it('onChange unsubscribe stops further deliveries', () => {
    const store = new SceneStore();
    const listener = vi.fn();
    const unsubscribe = store.onChange(listener);
    store.upsert(makeBox('a'));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.upsert(makeBox('b'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('upsertMany applies atomically and emits a single event', () => {
    const store = new SceneStore();
    const events: SceneStoreChangeEvent[] = [];
    store.onChange((ev) => events.push(ev));
    const primitives: Primitive[] = [makeBox('a'), makeSticky('b')];
    store.upsertMany(primitives);
    expect(store.getAllPrimitives()).toHaveLength(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: 'upsert',
      primitiveIds: [id('a'), id('b')],
    });
  });

  it('setSelection emits even when selection is identical', () => {
    const store = new SceneStore();
    const events: SceneStoreChangeEvent[] = [];
    store.onChange((ev) => events.push(ev));
    store.setSelection([id('a'), id('b')]);
    store.setSelection([id('a'), id('b')]);
    expect(events).toEqual([
      { kind: 'selection', primitiveIds: [id('a'), id('b')] },
      { kind: 'selection', primitiveIds: [id('a'), id('b')] },
    ]);
    expect(store.getSelection()).toEqual([id('a'), id('b')]);
  });

  it('setTheme emits a theme event and swaps the active theme', () => {
    const store = new SceneStore();
    const alt: Theme = { ...sketchyTheme, name: 'clean' };
    const events: SceneStoreChangeEvent[] = [];
    store.onChange((ev) => events.push(ev));
    store.setTheme(alt);
    expect(store.getTheme()).toBe(alt);
    expect(events).toEqual([{ kind: 'theme' }]);
  });

  it('upsert against a locked primitive throws SceneLockError', () => {
    const store = new SceneStore();
    store.lock([id('a')]);
    expect(store.isLocked(id('a'))).toBe(true);
    let captured: unknown;
    try {
      store.upsert(makeBox('a'));
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(SceneLockError);
    expect((captured as SceneLockError).primitiveId).toBe(id('a'));
    // Lock should also protect against batch upserts.
    expect(() => store.upsertMany([makeBox('a')])).toThrow(SceneLockError);
  });

  it('unlockAll clears locks so subsequent upserts succeed', () => {
    const store = new SceneStore();
    store.lock([id('a'), id('b')]);
    store.unlockAll();
    expect(store.isLocked(id('a'))).toBe(false);
    expect(store.isLocked(id('b'))).toBe(false);
    expect(() => store.upsert(makeBox('a'))).not.toThrow();
  });

  it('replaceAll emits clear then upsert and rebuilds the map', () => {
    const store = new SceneStore();
    store.upsert(makeBox('old'));
    const events: SceneStoreChangeEvent[] = [];
    store.onChange((ev) => events.push(ev));
    const fresh: Primitive[] = [makeBox('new-1'), makeBox('new-2')];
    store.replaceAll(fresh);
    expect(store.getAllPrimitives()).toHaveLength(2);
    expect(store.getPrimitive(id('old'))).toBeUndefined();
    expect(events).toEqual([
      { kind: 'clear' },
      { kind: 'upsert', primitiveIds: [id('new-1'), id('new-2')] },
    ]);
  });
});
