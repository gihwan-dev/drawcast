// `draw_export` tool — compile the current scene and serialize it into one
// of three Excalidraw-compatible envelopes (file JSON, clipboard JSON, or
// Obsidian markdown). See docs/05-mcp-server.md (PR #10, export).

import { z } from 'zod';
import {
  compile,
  serializeAsClipboardJSON,
  serializeAsExcalidrawFile,
  serializeAsObsidianMarkdown,
  type Scene,
  type SerializeOptions,
} from '@drawcast/core';
import { defineTool, type ToolExecutionResult } from './types.js';
import { formatZodError } from './utils.js';

const FormatSchema = z.enum(['excalidraw', 'clipboard', 'obsidian']);

export const drawExportInputSchema = z.object({
  format: FormatSchema,
  source: z.string().optional(),
  viewBackgroundColor: z.string().optional(),
  gridSize: z.union([z.number(), z.null()]).optional(),
  title: z.string().optional(),
});

export type DrawExportInput = z.infer<typeof drawExportInputSchema>;

const DESCRIPTION =
  'Compile the current scene and serialize it. Format picks the envelope: "excalidraw" (full file JSON), "clipboard" (paste JSON), or "obsidian" (.excalidraw.md body).';

export const drawExport = defineTool({
  name: 'draw_export',
  description: DESCRIPTION,
  inputSchema: drawExportInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['excalidraw', 'clipboard', 'obsidian'],
        description: 'Which envelope to emit',
      },
      source: {
        type: 'string',
        description: 'Attributed source URL baked into the file envelope',
      },
      viewBackgroundColor: {
        type: 'string',
        description: 'Canvas background (hex) baked into appState',
      },
      gridSize: {
        description: 'Grid size (null disables the grid)',
      },
      title: {
        type: 'string',
        description: 'Obsidian only: H1 title inserted above the drawing',
      },
    },
    required: ['format'],
  },
  async execute(rawArgs, store): Promise<ToolExecutionResult> {
    const parsed = drawExportInputSchema.safeParse(rawArgs);
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
    const args = parsed.data;

    // Build an L2 Scene view the core expects. `getScene` returns a cloned
    // Map so it's safe to hand straight to compile.
    const sceneSnapshot = store.getScene();
    const primitives = [...sceneSnapshot.primitives.values()];
    if (primitives.length === 0) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Scene is empty. Add primitives (draw_upsert_box, draw_upsert_edge, …) before exporting.',
          },
        ],
      };
    }

    const scene: Scene = sceneSnapshot;
    const result = compile(scene);

    // Warning summary — prepend a single line when we have any so the model
    // can surface them without inflating the output.
    const warnPrefix =
      result.warnings.length === 0
        ? ''
        : `// ${result.warnings.length} warning(s): ${result.warnings
            .map((w) => w.code)
            .join(', ')}\n`;

    const opts: SerializeOptions = {
      ...(args.source !== undefined && { source: args.source }),
      ...(args.viewBackgroundColor !== undefined && {
        viewBackgroundColor: args.viewBackgroundColor,
      }),
      ...(args.gridSize !== undefined && { gridSize: args.gridSize }),
    };

    let payload: string;
    switch (args.format) {
      case 'excalidraw': {
        const envelope = serializeAsExcalidrawFile(result, opts);
        payload = JSON.stringify(envelope, null, 2);
        break;
      }
      case 'clipboard': {
        const envelope = serializeAsClipboardJSON(result);
        payload = JSON.stringify(envelope, null, 2);
        break;
      }
      case 'obsidian': {
        payload = serializeAsObsidianMarkdown(result, {
          ...opts,
          ...(args.title !== undefined && { title: args.title }),
        });
        break;
      }
    }

    return {
      content: [{ type: 'text', text: `${warnPrefix}${payload}` }],
    };
  },
});
