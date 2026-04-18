// `draw_set_theme` tool — switch the active theme. Accepts either one of the
// three built-in preset names (`sketchy`, `clean`, `mono`) or a full inline
// Theme object. Per the PR-10 spec we do NOT deeply validate custom
// themes — a shallow shape check is enough. See docs/05-mcp-server.md.

import { z } from 'zod';
import { cleanTheme, monoTheme, sketchyTheme } from '@drawcast/core';
import type { Theme } from '@drawcast/core';
import { defineTool, type ToolExecutionResult } from './types.js';
import { formatZodError } from './utils.js';

const BUILTIN_NAMES = ['sketchy', 'clean', 'mono'] as const;
type BuiltinName = (typeof BUILTIN_NAMES)[number];

const BUILTIN_THEMES: Record<BuiltinName, Theme> = {
  sketchy: sketchyTheme,
  clean: cleanTheme,
  mono: monoTheme,
};

/**
 * Theme argument variant: either a literal string name or an arbitrary
 * object. We intentionally use `z.record` (not a strictly-typed shape) for
 * the object branch so the model can pass custom presets without being
 * constrained by our public Theme type.
 */
const ThemeArgSchema = z.union([
  z.enum(BUILTIN_NAMES),
  z.object({
    name: z.string().min(1),
    defaultFontFamily: z.number().optional(),
    defaultFontSize: z.number().optional(),
    nodes: z.record(z.unknown()),
    edges: z.record(z.unknown()),
    global: z.record(z.unknown()),
  }).passthrough(),
]);

export const drawSetThemeInputSchema = z.object({
  theme: ThemeArgSchema,
});

export type DrawSetThemeInput = z.infer<typeof drawSetThemeInputSchema>;

const DESCRIPTION =
  'Switch the active theme. Accepts a built-in preset name ("sketchy", "clean", or "mono") or a custom Theme object with {name, nodes, edges, global}.';

export const drawSetTheme = defineTool({
  name: 'draw_set_theme',
  description: DESCRIPTION,
  inputSchema: drawSetThemeInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      theme: {
        description:
          'Built-in name ("sketchy"/"clean"/"mono") or an inline Theme object',
        oneOf: [
          { type: 'string', enum: [...BUILTIN_NAMES] },
          {
            type: 'object',
            properties: {
              name: { type: 'string' },
              nodes: { type: 'object' },
              edges: { type: 'object' },
              global: { type: 'object' },
            },
            required: ['name', 'nodes', 'edges', 'global'],
          },
        ],
      },
    },
    required: ['theme'],
  },
  async execute(rawArgs, store): Promise<ToolExecutionResult> {
    const parsed = drawSetThemeInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Invalid input: ${formatZodError(parsed.error)}`,
          },
        ],
      };
    }
    const { theme } = parsed.data;

    let resolved: Theme;
    let descriptor: string;
    if (typeof theme === 'string') {
      resolved = BUILTIN_THEMES[theme];
      descriptor = `built-in "${theme}"`;
    } else {
      // Per spec: accept the object shape, pass through — don't deeply
      // validate every preset field. Cast is intentional and narrow.
      resolved = theme as unknown as Theme;
      descriptor = `custom "${resolved.name}"`;
    }

    store.setTheme(resolved);
    return {
      content: [
        { type: 'text', text: `\u2713 theme set to ${descriptor}` },
      ],
    };
  },
});
