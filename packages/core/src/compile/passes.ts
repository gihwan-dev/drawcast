// The 3 compile passes. Each consumes the scene.primitives map and mutates
// the CompileContext. Ordering is load-bearing: relational bindings and
// grouping BOTH require positional emit to have registered primitives.
// See docs/03 §15-31.

import type { Connector, PrimitiveId, Scene } from '../primitives.js';
import type { CompileContext } from './context.js';
import { emitLabelBox } from '../emit/labelBox.js';
import { emitSticky } from '../emit/sticky.js';
import {
  clearEdgeLabelsFromOtherArrows,
  emitConnector,
  type ConnectorLane,
} from '../emit/connector.js';
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
 *
 * Before emitting, we bucket connectors by their unordered endpoint pair so
 * each emitter gets a {index, count} lane assignment. Parallel connectors
 * (multiple edges between the same two shapes — including bidirectional
 * pairs) are then offset perpendicular to the arrow direction so their lines
 * and labels don't overlap in the exported scene.
 */
export function passRelational(scene: Scene, ctx: CompileContext): void {
  const connectors: Connector[] = [];
  for (const p of scene.primitives.values()) {
    if (p.kind === 'connector') connectors.push(p);
  }

  const lanes = assignConnectorLanes(connectors);
  for (const p of connectors) {
    emitConnector(p, ctx, lanes.get(p.id));
  }

  // After every arrow + bound label is emitted, sweep for labels that
  // landed on a non-own arrow's polyline and shift the owning arrow's
  // middle segment perpendicular so the anchored label clears. Runs here
  // (not per-connector) so the sweep sees the full final arrow set rather
  // than only the prefix emitted before this connector.
  clearEdgeLabelsFromOtherArrows(ctx);
}

function assignConnectorLanes(
  connectors: readonly Connector[],
): Map<PrimitiveId, ConnectorLane> {
  const groups = new Map<string, Connector[]>();
  for (const c of connectors) {
    const key = pairKey(c);
    if (key === null) continue;
    const list = groups.get(key);
    if (list) {
      list.push(c);
    } else {
      groups.set(key, [c]);
    }
  }

  const lanes = new Map<PrimitiveId, ConnectorLane>();
  for (const list of groups.values()) {
    if (list.length <= 1) continue;
    list.forEach((c, index) => {
      lanes.set(c.id, { index, count: list.length });
    });
  }
  return lanes;
}

function pairKey(c: Connector): string | null {
  const from = typeof c.from === 'string' ? c.from : null;
  const to = typeof c.to === 'string' ? c.to : null;
  if (from === null || to === null) return null;
  return from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`;
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
