// Behaviour tests for the `draw_export` tool across all three envelopes.

import { describe, expect, it } from 'vitest';
import type { PrimitiveId } from '@drawcast/core';
import { SceneStore } from '../src/store.js';
import { drawExport } from '../src/tools/drawExport.js';

function asId(raw: string): PrimitiveId {
  return raw as PrimitiveId;
}

function seedStore(): SceneStore {
  const store = new SceneStore();
  store.upsert({
    kind: 'labelBox',
    id: asId('a'),
    shape: 'rectangle',
    at: [0, 0],
    text: 'Hello',
  });
  store.upsert({
    kind: 'labelBox',
    id: asId('b'),
    shape: 'ellipse',
    at: [200, 0],
    text: 'World',
  });
  return store;
}

describe('draw_export', () => {
  it('emits a full Excalidraw file envelope when format:"excalidraw"', async () => {
    const store = seedStore();
    const result = await drawExport.execute({ format: 'excalidraw' }, store);
    expect(result.isError).toBeUndefined();
    // Strip optional warning prefix before parsing.
    const body = result.content[0]!.text.replace(/^\/\/ [^\n]*\n/, '');
    const parsed = JSON.parse(body) as {
      type: string;
      version: number;
      elements: unknown[];
      appState: { viewBackgroundColor: string };
    };
    expect(parsed.type).toBe('excalidraw');
    expect(parsed.version).toBe(2);
    expect(Array.isArray(parsed.elements)).toBe(true);
    expect(parsed.elements.length).toBeGreaterThan(0);
    expect(parsed.appState.viewBackgroundColor).toBe('#ffffff');
  });

  it('emits a clipboard envelope when format:"clipboard"', async () => {
    const store = seedStore();
    const result = await drawExport.execute({ format: 'clipboard' }, store);
    expect(result.isError).toBeUndefined();
    const body = result.content[0]!.text.replace(/^\/\/ [^\n]*\n/, '');
    const parsed = JSON.parse(body) as {
      type: string;
      elements: unknown[];
    };
    expect(parsed.type).toBe('excalidraw/clipboard');
    expect(Array.isArray(parsed.elements)).toBe(true);
  });

  it('emits Obsidian markdown when format:"obsidian"', async () => {
    const store = seedStore();
    const result = await drawExport.execute(
      { format: 'obsidian', title: 'Diagram' },
      store,
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]!.text;
    expect(text).toContain('excalidraw-plugin: parsed');
    expect(text).toContain('# Diagram');
    expect(text).toContain('```json');
  });

  it('returns isError on an empty scene', async () => {
    const store = new SceneStore();
    const result = await drawExport.execute({ format: 'excalidraw' }, store);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/empty/i);
  });

  it('honours viewBackgroundColor and source overrides', async () => {
    const store = seedStore();
    const result = await drawExport.execute(
      {
        format: 'excalidraw',
        source: 'https://example.com',
        viewBackgroundColor: '#222222',
      },
      store,
    );
    const body = result.content[0]!.text.replace(/^\/\/ [^\n]*\n/, '');
    const parsed = JSON.parse(body) as {
      source: string;
      appState: { viewBackgroundColor: string };
    };
    expect(parsed.source).toBe('https://example.com');
    expect(parsed.appState.viewBackgroundColor).toBe('#222222');
  });
});
