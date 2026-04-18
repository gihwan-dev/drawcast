// Behaviour tests for the `draw_set_theme` tool (built-in names + custom object).

import { describe, expect, it } from 'vitest';
import { SceneStore } from '../src/store.js';
import { drawSetTheme } from '../src/tools/drawSetTheme.js';

describe('draw_set_theme', () => {
  it('switches to a built-in preset by name', async () => {
    const store = new SceneStore();
    expect(store.getTheme().name).toBe('sketchy');
    const result = await drawSetTheme.execute({ theme: 'clean' }, store);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(/built-in/);
    expect(store.getTheme().name).toBe('clean');
    // clean theme has roughness 0 globally.
    expect(store.getTheme().global.roughness).toBe(0);
  });

  it('accepts a custom inline theme object', async () => {
    const store = new SceneStore();
    const custom = {
      name: 'my-theme',
      defaultFontFamily: 2,
      defaultFontSize: 16,
      nodes: { default: { strokeColor: '#000' } },
      edges: { default: { strokeColor: '#000' } },
      global: { roughness: 0 },
    };
    const result = await drawSetTheme.execute({ theme: custom }, store);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(/custom/);
    expect(store.getTheme().name).toBe('my-theme');
  });

  it('returns isError when the theme argument is malformed', async () => {
    const store = new SceneStore();
    const result = await drawSetTheme.execute(
      { theme: 'lemon-drop' } as never,
      store,
    );
    expect(result.isError).toBe(true);
    // Active theme is unchanged.
    expect(store.getTheme().name).toBe('sketchy');
  });
});
