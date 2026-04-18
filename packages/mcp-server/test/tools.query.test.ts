// Behaviour tests for the query tools: get_scene, get_primitive,
// get_selection, list_style_presets.

import { describe, expect, it } from 'vitest';
import {
  cleanTheme,
  type LabelBox,
  type PrimitiveId,
} from '@drawcast/core';
import { SceneStore } from '../src/store.js';
import { drawGetPrimitive } from '../src/tools/drawGetPrimitive.js';
import { drawGetScene } from '../src/tools/drawGetScene.js';
import { drawGetSelection } from '../src/tools/drawGetSelection.js';
import { drawListStylePresets } from '../src/tools/drawListStylePresets.js';

function asId(raw: string): PrimitiveId {
  return raw as PrimitiveId;
}

function parseText(result: { content: { text: string }[] }): unknown {
  return JSON.parse(result.content[0]!.text);
}

describe('draw_get_scene', () => {
  it('returns the scene with primitives, theme name, selection, and locked ids', async () => {
    const store = new SceneStore();
    store.upsert({
      kind: 'labelBox',
      id: asId('a'),
      shape: 'rectangle',
      at: [0, 0],
    });
    store.upsert({
      kind: 'labelBox',
      id: asId('b'),
      shape: 'rectangle',
      at: [100, 0],
    });
    store.setSelection([asId('a')]);
    store.lock([asId('b')]);

    const result = await drawGetScene.execute({}, store);
    expect(result.isError).toBeUndefined();
    const snapshot = parseText(result) as {
      primitives: { id: string }[];
      theme: { name: string };
      selection: string[];
      locked: string[];
    };
    expect(snapshot.primitives).toHaveLength(2);
    expect(snapshot.theme).toEqual({ name: 'sketchy' });
    expect(snapshot.selection).toEqual(['a']);
    expect(snapshot.locked).toEqual(['b']);
  });

  it('returns an empty scene gracefully', async () => {
    const store = new SceneStore();
    const result = await drawGetScene.execute({}, store);
    const snapshot = parseText(result) as {
      primitives: unknown[];
      selection: unknown[];
      locked: unknown[];
    };
    expect(snapshot.primitives).toEqual([]);
    expect(snapshot.selection).toEqual([]);
    expect(snapshot.locked).toEqual([]);
  });
});

describe('draw_get_primitive', () => {
  it('returns a single primitive as JSON', async () => {
    const store = new SceneStore();
    const box: LabelBox = {
      kind: 'labelBox',
      id: asId('box-1'),
      shape: 'rectangle',
      at: [0, 0],
      text: 'Hello',
    };
    store.upsert(box);
    const result = await drawGetPrimitive.execute({ id: 'box-1' }, store);
    expect(result.isError).toBeUndefined();
    const parsed = parseText(result) as LabelBox;
    expect(parsed.id).toBe('box-1');
    expect(parsed.text).toBe('Hello');
  });

  it('returns isError when no such id exists', async () => {
    const store = new SceneStore();
    const result = await drawGetPrimitive.execute({ id: 'missing' }, store);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/missing/);
  });
});

describe('draw_get_selection', () => {
  it('mirrors the store selection', async () => {
    const store = new SceneStore();
    store.setSelection([asId('a'), asId('b')]);
    const result = await drawGetSelection.execute({}, store);
    const parsed = parseText(result) as { selection: string[] };
    expect(parsed.selection.sort()).toEqual(['a', 'b']);
  });
});

describe('draw_list_style_presets', () => {
  it('returns node and edge preset names for the sketchy theme', async () => {
    const store = new SceneStore();
    const result = await drawListStylePresets.execute({}, store);
    const parsed = parseText(result) as {
      theme: string;
      nodes: string[];
      edges: string[];
    };
    expect(parsed.theme).toBe('sketchy');
    expect(parsed.nodes).toContain('default');
    expect(parsed.nodes).toContain('process');
    expect(parsed.edges).toContain('default');
  });

  it('reflects the active theme after setTheme', async () => {
    const store = new SceneStore();
    store.setTheme(cleanTheme);
    const result = await drawListStylePresets.execute({}, store);
    const parsed = parseText(result) as { theme: string };
    expect(parsed.theme).toBe('clean');
  });
});
