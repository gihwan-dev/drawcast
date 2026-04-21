// Apply laid-out coordinates back onto the Scene's primitives. The output
// is a fresh Scene with updated labelBoxes; everything else passes through
// untouched so the existing emit layer (including the Phase 1 port-aware
// elbow routing in connector.ts) sees the same primitive shape it would
// on the synchronous compile path.

import type { LabelBox, Primitive, Scene } from '../primitives.js';
import type { LaidOutGraph, LaidOutNode } from './engine.js';

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
