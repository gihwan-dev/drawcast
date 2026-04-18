// Serialization tests. The three envelopes are thin adapters, so the
// tests focus on envelope shape, source override, and `isDeleted` filtering.
// Obsidian markdown is smoke-tested: frontmatter + JSON fence present.

import { describe, expect, it } from 'vitest';
import {
  serializeAsClipboardJSON,
  serializeAsExcalidrawFile,
  serializeAsObsidianMarkdown,
} from '../src/serialize.js';
import type { CompileResult } from '../src/compile/context.js';
import { compile } from '../src/compile/index.js';
import { sketchyTheme } from '../src/theme.js';
import { baseElementFields } from '../src/utils/baseElementFields.js';
import type {
  BinaryFiles,
  ExcalidrawElement,
  ExcalidrawRectangleElement,
  FileId,
} from '../src/types/excalidraw.js';
import type { LabelBox, PrimitiveId, Radians, Scene } from '../src/primitives.js';

function emptyResult(): CompileResult {
  return { elements: [], files: {}, warnings: [] };
}

function makeRect(overrides: Partial<ExcalidrawRectangleElement> = {}): ExcalidrawRectangleElement {
  const base = baseElementFields({ id: overrides.id ?? 'r1' });
  return {
    ...base,
    type: 'rectangle',
    angle: base.angle as Radians,
    ...overrides,
  };
}

describe('serializeAsExcalidrawFile', () => {
  it('wraps an empty result in the official envelope', () => {
    const env = serializeAsExcalidrawFile(emptyResult());
    expect(env.type).toBe('excalidraw');
    expect(env.version).toBe(2);
    expect(env.source).toBe('https://drawcast.local');
    expect(env.elements).toEqual([]);
    expect(env.files).toEqual({});
    expect(env.appState).toEqual({
      viewBackgroundColor: '#ffffff',
      gridSize: null,
    });
    // P24 — appState must be an object, never a stringified JSON.
    expect(typeof env.appState).toBe('object');
  });

  it('respects the source option override', () => {
    const env = serializeAsExcalidrawFile(emptyResult(), { source: 'custom' });
    expect(env.source).toBe('custom');
  });

  it('filters out elements with isDeleted: true', () => {
    const keep = makeRect({ id: 'keep' });
    const drop = makeRect({ id: 'drop', isDeleted: true });
    const result: CompileResult = {
      elements: [keep, drop],
      files: {},
      warnings: [],
    };
    const env = serializeAsExcalidrawFile(result);
    expect(env.elements).toHaveLength(1);
    expect(env.elements[0]!.id).toBe('keep');
  });

  it('includes gridStep when gridSize is provided', () => {
    const env = serializeAsExcalidrawFile(emptyResult(), { gridSize: 20 });
    expect(env.appState.gridSize).toBe(20);
    expect(env.appState.gridStep).toBe(5);
  });
});

describe('serializeAsClipboardJSON', () => {
  it('omits the files property when no files are present', () => {
    const env = serializeAsClipboardJSON(emptyResult());
    expect(env.type).toBe('excalidraw/clipboard');
    expect(env.elements).toEqual([]);
    expect('files' in env).toBe(false);
  });

  it('includes the files property when files are present', () => {
    const fileId = 'file-1' as FileId;
    const files: BinaryFiles = {
      [fileId]: {
        id: fileId,
        mimeType: 'image/png',
        dataURL: 'data:image/png;base64,AA',
        created: 1,
        lastRetrieved: 1,
      },
    };
    const env = serializeAsClipboardJSON({
      elements: [],
      files,
      warnings: [],
    });
    expect(env.files).toBe(files);
  });

  it('filters isDeleted elements from clipboard payload', () => {
    const keep = makeRect({ id: 'keep' });
    const drop = makeRect({ id: 'drop', isDeleted: true });
    const env = serializeAsClipboardJSON({
      elements: [keep, drop],
      files: {},
      warnings: [],
    });
    expect(env.elements.map((e: ExcalidrawElement) => e.id)).toEqual(['keep']);
  });
});

describe('serializeAsObsidianMarkdown', () => {
  it('produces the Obsidian Excalidraw plugin frontmatter and JSON fence', () => {
    const boxA: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 0],
      text: 'Hi',
    };
    const scene: Scene = {
      primitives: new Map([[boxA.id, boxA]]),
      theme: sketchyTheme,
    };
    const result = compile(scene);
    const md = serializeAsObsidianMarkdown(result, { title: 'My Diagram' });

    expect(md).toContain('excalidraw-plugin: parsed');
    expect(md).toContain('tags: [excalidraw]');
    expect(md).toContain('# My Diagram');
    expect(md).toContain('# Text Elements');
    expect(md).toContain('%%');
    expect(md).toContain('```json');
    expect(md).toContain('```');
    // The JSON inside must be parseable and represent the file envelope.
    const jsonStart = md.indexOf('```json\n') + '```json\n'.length;
    const jsonEnd = md.indexOf('\n```', jsonStart);
    const parsed = JSON.parse(md.slice(jsonStart, jsonEnd)) as {
      type: string;
      elements: unknown[];
    };
    expect(parsed.type).toBe('excalidraw');
    expect(Array.isArray(parsed.elements)).toBe(true);
  });
});
