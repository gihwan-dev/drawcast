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

import type { Primitive, Scene } from '../primitives.js';
import type { GraphEdge, GraphModel, GraphNode } from './graph.js';

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
      const node = labelBoxToNode(primitive);
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
): GraphNode {
  const node: GraphNode = {
    id: primitive.id,
    primitiveIds: [primitive.id],
  };
  // Measured size takes priority; without it ELK falls back to engine
  // defaults (DEFAULT_NODE_WIDTH/HEIGHT) which loosely match the
  // labelBox auto-fit output from Phase 1.
  if (primitive.size !== undefined) {
    node.width = primitive.size[0];
    node.height = primitive.size[1];
  }
  return node;
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
