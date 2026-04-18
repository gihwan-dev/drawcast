// The 3 compile passes. Each consumes the scene.primitives map and mutates
// the CompileContext. Ordering is load-bearing: relational bindings and
// grouping BOTH require positional emit to have registered primitives.
// See docs/03 §15-31.

import type { Scene } from '../primitives.js';
import type { CompileContext } from './context.js';
import { emitLabelBox } from '../emit/labelBox.js';
import { emitSticky } from '../emit/sticky.js';
import { emitConnector } from '../emit/connector.js';
import { applyGroup } from '../emit/group.js';
import { emitFrame, applyFrameChildren } from '../emit/frame.js';
import { emitLine } from '../emit/line.js';
import { emitFreedraw } from '../emit/freedraw.js';
import { emitImage } from '../emit/image.js';
import { emitEmbed } from '../emit/embed.js';

/**
 * Pass 1 — "Positional": emit shape + standalone element primitives and
 * record their bounding boxes. Connector/Group intentionally deferred.
 *
 * Coverage primitives (line, freedraw, image, embed) are emitted here too —
 * they are standalone and do not require a binding pass.
 */
export function passPositional(scene: Scene, ctx: CompileContext): void {
  for (const p of scene.primitives.values()) {
    switch (p.kind) {
      case 'labelBox':
        emitLabelBox(p, ctx);
        break;
      case 'sticky':
        emitSticky(p, ctx);
        break;
      case 'frame':
        emitFrame(p, ctx);
        break;
      case 'line':
        emitLine(p, ctx);
        break;
      case 'freedraw':
        emitFreedraw(p, ctx);
        break;
      case 'image':
        emitImage(p, ctx);
        break;
      case 'embed':
        emitEmbed(p, ctx);
        break;
      case 'connector':
      case 'group':
        // Handled in later passes.
        break;
    }
  }
}

/**
 * Pass 2 — "Relational": emit connectors now that every bindable primitive
 * has a registry entry.
 */
export function passRelational(scene: Scene, ctx: CompileContext): void {
  for (const p of scene.primitives.values()) {
    if (p.kind === 'connector') emitConnector(p, ctx);
  }
}

/**
 * Pass 3 — "Grouping": apply group & frame parent-child relationships by
 * mutating existing element ids onto their children. No new elements emitted.
 */
export function passGrouping(scene: Scene, ctx: CompileContext): void {
  for (const p of scene.primitives.values()) {
    if (p.kind === 'group') applyGroup(p, ctx);
  }
  for (const p of scene.primitives.values()) {
    if (p.kind === 'frame') applyFrameChildren(p, ctx);
  }
}
