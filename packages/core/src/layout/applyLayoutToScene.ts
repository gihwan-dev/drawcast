// Apply laid-out coordinates back onto the Scene's primitives. Two
// updates flow out of the layout pass:
//
//   - labelBox nodes receive new `at` + `size` so the emitted shape
//     lands where ELK placed it.
//   - connectors receive `routedPath` (from ELK edge sections) so the
//     emit layer renders the engine-computed polyline instead of
//     re-deriving one via port selection + elbow math. Without this
//     step ELK's node-avoiding routing is thrown away and the Phase 1
//     built-in router reintroduces through-node edges.
//
// Everything else passes through untouched so sync compile output on
// the Tauri path is identical when the flag is off.

import type { LabelBox, Point, Primitive, PrimitiveId, Scene } from '../primitives.js';
import type { LaidOutEdge, LaidOutGraph, LaidOutNode } from './engine.js';

export function applyLayoutToScene(scene: Scene, laid: LaidOutGraph): Scene {
  const updated = new Map<Primitive['id'], Primitive>(scene.primitives);

  const walk = (nodes: readonly LaidOutNode[]): void => {
    for (const node of nodes) {
      for (const primitiveId of node.primitiveIds) {
        const primitive = updated.get(primitiveId);
        if (primitive === undefined) continue;
        if (primitive.kind !== 'labelBox') continue;
        updated.set(primitiveId, applyToLabelBox(primitive, node));
      }
      if (node.children !== undefined) walk(node.children);
    }
  };
  walk(laid.children);

  for (const edge of laid.edges) {
    // GraphEdge.id is a plain string from the graph layer; the Scene's
    // Map keys are brand-typed PrimitiveId, but the value originated
    // from a Connector we already own, so the cast is safe.
    const edgeId = edge.id as PrimitiveId;
    const primitive = updated.get(edgeId);
    if (primitive === undefined || primitive.kind !== 'connector') continue;
    const path = toRoutedPath(edge);
    if (path === null) continue;
    updated.set(edgeId, { ...primitive, routedPath: path });
  }

  return { ...scene, primitives: updated };
}

function applyToLabelBox(primitive: LabelBox, node: LaidOutNode): LabelBox {
  // LabelBox.at is a center point (see emit/labelBox.ts:217-218) while
  // ELK reports node origin as the top-left; translate before assigning.
  // Pin size via fit='fixed' so downstream text measurement keeps the
  // laid-out dimensions instead of re-fitting to the inner label.
  return {
    ...primitive,
    at: [node.x + node.width / 2, node.y + node.height / 2],
    fit: 'fixed',
    size: [node.width, node.height],
  };
}

/**
 * Flatten an ELK edge into a Connector.routedPath polyline.
 *
 * ELK supplies one ElkEdgeSection per edge for flat graphs (multi-
 * section output is reserved for compound hierarchies Phase 3 will
 * enable). A section carries a start point, an end point, and an
 * optional bendPoints array — stitch them in order.
 */
function toRoutedPath(edge: LaidOutEdge): readonly Point[] | null {
  const sections = edge.sections;
  if (sections === undefined || sections.length === 0) return null;
  const first = sections[0]!;
  const points: Point[] = [[first.startPoint.x, first.startPoint.y]];
  for (const section of sections) {
    if (section.bendPoints !== undefined) {
      for (const bend of section.bendPoints) {
        points.push([bend.x, bend.y]);
      }
    }
    points.push([section.endPoint.x, section.endPoint.y]);
  }
  return points;
}
