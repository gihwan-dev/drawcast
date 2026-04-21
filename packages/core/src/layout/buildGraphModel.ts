// Scene -> GraphModel translator. Phase 2 scope is flat flowchart graphs
// only: every LabelBox becomes a GraphNode, every bound Connector becomes
// a GraphEdge, and every other primitive kind is ignored by the layout
// layer so its `at`/`size` stay untouched after layout.
//
// Frames are intentionally a skip trigger. The compound-graph translation
// (Frame -> nested `children` + `elk.hierarchyHandling: INCLUDE_CHILDREN`)
// lands in Phase 3 along with the architecture diagram preset. Until then
// we do not want partial support to silently rearrange Frame-bound nodes
// out of their container, so `buildGraphModel` reports null and the
// caller falls back to the synchronous compile path.

import { measureText } from '../measure.js';
import type { Primitive, Scene } from '../primitives.js';
import type { Theme } from '../theme.js';
import type { GraphEdge, GraphModel, GraphNode } from './graph.js';

// Matches emit/labelBox.ts: padding + minimums applied to auto-fit nodes.
// Keep in sync with DEFAULT_PADDING/min-width/min-height in that module so
// ELK sees the same dimensions the emit pass will ultimately render.
const AUTO_FIT_PADDING = 20;
const AUTO_FIT_MIN_WIDTH = 80;
const AUTO_FIT_MIN_HEIGHT = 40;

export interface BuildGraphModelOptions {
  /** When true (default) a scene that contains any Frame is treated as
   *  out-of-scope and the function returns null. Phase 3 flips this. */
  skipIfFrame?: boolean;
  /** Scene id passed through to ELK for deterministic logging. */
  id?: string;
}

export function buildGraphModel(
  scene: Scene,
  options: BuildGraphModelOptions = {},
): GraphModel | null {
  const skipIfFrame = options.skipIfFrame ?? true;
  const primitives = [...scene.primitives.values()];

  if (skipIfFrame && primitives.some((p) => p.kind === 'frame')) {
    return null;
  }

  const nodes: GraphNode[] = [];
  const nodeIds = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const primitive of primitives) {
    if (primitive.kind === 'labelBox') {
      const node = labelBoxToNode(primitive, scene.theme);
      nodes.push(node);
      nodeIds.add(node.id);
    }
  }

  for (const primitive of primitives) {
    if (primitive.kind === 'connector') {
      const edge = connectorToEdge(primitive, nodeIds);
      if (edge !== null) edges.push(edge);
    }
  }

  return {
    id: options.id ?? 'scene',
    diagramType: 'flowchart',
    children: nodes,
    edges,
  };
}

function labelBoxToNode(
  primitive: Extract<Primitive, { kind: 'labelBox' }>,
  theme: Theme,
): GraphNode {
  const node: GraphNode = {
    id: primitive.id,
    primitiveIds: [primitive.id],
  };
  // Explicit size (fit='fixed' or caller-pinned) wins. Otherwise mirror
  // emitLabelBox's auto-fit so ELK sees the same dimensions the emit
  // pass will produce; without this the engine default 160x60 is too
  // small for multi-line or CJK labels and emit visibly clips the text.
  if (primitive.size !== undefined) {
    node.width = primitive.size[0];
    node.height = primitive.size[1];
  } else {
    const fit = computeAutoFitSize(primitive, theme);
    node.width = fit.width;
    node.height = fit.height;
  }
  // An explicit `at` is the LLM's (or user's) positional intent — pass
  // it to ELK as a fixed-position hint so the layer algorithm tries to
  // respect it. `at` is centre-based; ELK expects top-left, so we need
  // a size to translate and skip the hint otherwise. Layered treats
  // `elk.position` as a soft hint today; Phase 3 will introduce the
  // interactive/fixed algorithm for hard pinning.
  if (primitive.at !== undefined && primitive.size !== undefined) {
    node.fixedPosition = {
      x: primitive.at[0] - primitive.size[0] / 2,
      y: primitive.at[1] - primitive.size[1] / 2,
    };
  }
  return node;
}

function computeAutoFitSize(
  primitive: Extract<Primitive, { kind: 'labelBox' }>,
  theme: Theme,
): { width: number; height: number } {
  if (primitive.text === undefined || primitive.text.length === 0) {
    return { width: AUTO_FIT_MIN_WIDTH, height: AUTO_FIT_MIN_HEIGHT };
  }
  const fontFamily = primitive.fontFamily ?? theme.defaultFontFamily;
  const fontSize = primitive.fontSize ?? theme.defaultFontSize;
  const metrics = measureText({ text: primitive.text, fontSize, fontFamily });
  return {
    width: Math.max(metrics.width + AUTO_FIT_PADDING * 2, AUTO_FIT_MIN_WIDTH),
    height: Math.max(metrics.height + AUTO_FIT_PADDING * 2, AUTO_FIT_MIN_HEIGHT),
  };
}

function connectorToEdge(
  primitive: Extract<Primitive, { kind: 'connector' }>,
  knownNodeIds: ReadonlySet<string>,
): GraphEdge | null {
  // Only id-bound connectors participate. Raw Point endpoints are for
  // floating annotation arrows and must not influence layered layout.
  if (typeof primitive.from !== 'string' || typeof primitive.to !== 'string') {
    return null;
  }
  // Dropping dangling edges keeps ELK from blowing up on unknown ids;
  // the emit layer already warns on orphan references so we stay quiet.
  if (!knownNodeIds.has(primitive.from) || !knownNodeIds.has(primitive.to)) {
    return null;
  }
  return {
    id: primitive.id,
    source: primitive.from,
    target: primitive.to,
    routing: 'orthogonal',
  };
}
