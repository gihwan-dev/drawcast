// Sample scene loader for the Welcome overlay. Seeds `sceneStore` with
// three L2 primitives — two LabelBoxes plus a Connector between them —
// so a first-time user can see the compile pipeline light up the canvas
// before they've connected a CLI. The primitives live client-only in
// sceneStore; they don't round-trip through the MCP server. If the user
// later connects a CLI, the next scene/apply from the server replaces
// them as usual.
//
// We deliberately keep the shapes minimal (no custom styling, default
// theme) so `compile()` produces zero warnings — the sample doubles as
// evidence that the L2 pipeline works.

import type { Connector, LabelBox, Primitive, PrimitiveId } from '@drawcast/core';
import { useSceneStore } from '../store/sceneStore.js';

const INPUT_ID = 'sample-input' as PrimitiveId;
const PROCESS_ID = 'sample-process' as PrimitiveId;
const EDGE_ID = 'sample-edge' as PrimitiveId;

function buildSamplePrimitives(): readonly Primitive[] {
  const input: LabelBox = {
    kind: 'labelBox',
    id: INPUT_ID,
    shape: 'rectangle',
    at: [100, 200],
    text: 'Input',
  };
  const process: LabelBox = {
    kind: 'labelBox',
    id: PROCESS_ID,
    shape: 'rectangle',
    at: [300, 200],
    text: 'Process',
  };
  const edge: Connector = {
    kind: 'connector',
    id: EDGE_ID,
    from: INPUT_ID,
    to: PROCESS_ID,
  };
  return [input, process, edge];
}

/**
 * Populate `sceneStore` with a minimal Input → Process flow. Safe to call
 * multiple times; the snapshot is a full replacement. The default theme
 * (`sketchy`) matches what the MCP server would send for an unattached
 * session.
 */
export function loadSampleScene(): void {
  useSceneStore.getState().setSnapshot({
    primitives: buildSamplePrimitives(),
    theme: 'sketchy',
    selection: [],
    locked: [],
  });
}

// Exposed for the welcome tests — lets them assert on exact primitive
// shapes without reaching into the store.
export const __SAMPLE_PRIMITIVES_FOR_TEST = buildSamplePrimitives;
