// Phase 2: Node/MCP context only.
// Consumers: `@drawcast/mcp-server` when composing a scene, and `drawcast-evals`
// when regenerating baselines. The Tauri WebView must NOT reach this file;
// it receives the already-laid-out scene via IPC and paints it with the
// legacy synchronous `compile`. See docs/11-layout-engine.md §9.5 for the
// rationale — Web Worker / Tauri Web Worker resolution is out of scope until
// Phase 3 introduces in-app re-layout.

import ElkConstructor, {
  type ELK,
  type ElkEdgeSection,
  type ElkExtendedEdge,
  type ElkNode,
  type ElkPoint,
  type ElkPort,
  type LayoutOptions,
} from 'elkjs/lib/elk.bundled.js';

import type {
  DiagramType,
  GraphEdge,
  GraphModel,
  GraphNode,
  GraphPort,
} from './graph.js';
import type {
  LaidOutEdge,
  LaidOutEdgeSection,
  LaidOutGraph,
  LaidOutNode,
  LayoutEngine,
} from './engine.js';

/** Default bounding box used when a node arrives without measured size.
 *  Picked to roughly match the Phase 1 LabelBox "auto-fit" output so
 *  ELK spacing values tune similarly. */
const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = 60;

/** Map diagram archetype -> ELK algorithm. `sequence` still falls to
 *  `layered` in Phase 2 since a time-axis layout is deferred to Phase 4
 *  per the roadmap; keeping the mapping total means `auto` never hits
 *  an undefined branch. */
const ALGORITHM_BY_TYPE: Record<DiagramType, string> = {
  flowchart: 'layered',
  tree: 'mrtree',
  mindmap: 'radial',
  class: 'layered',
  er: 'stress',
  architecture: 'layered',
  sequence: 'layered',
  auto: 'layered',
};

/** Baseline layout options. Values kept as strings because ELK's JSON
 *  options dict expects strings regardless of the underlying numeric
 *  type. `elk.randomSeed` pins determinism per docs §2.4.
 *
 *  `layering.strategy=LONGEST_PATH_SOURCE` anchors every source node
 *  (incoming-edge count == 0, e.g. the "start" primitive in a flowchart)
 *  to the first layer. ELK's default `NETWORK_SIMPLEX` minimises total
 *  edge length and, in graphs with retry loops (e.g. "재시도? → 입력"),
 *  happily demotes the source to a middle/bottom layer — which rubric
 *  reviewers consistently flagged as an unnatural flow. This strategy
 *  does not depend on Claude's node-definition order, so it's stable
 *  across the non-deterministic AI output. */
const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.spacing.nodeNode': '60',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.layered.layering.strategy': 'LONGEST_PATH_SOURCE',
  'elk.randomSeed': '1',
};

export interface ElkLayoutEngineOptions {
  /** Overrides layered onto DEFAULT_LAYOUT_OPTIONS for every call. Per-
   *  call options passed via `GraphModel.layoutOptions` override these. */
  layoutOptions?: LayoutOptions;
  /** Injected for tests. Defaults to a fresh `elkjs` instance. */
  elk?: ELK;
}

export class ElkLayoutEngine implements LayoutEngine {
  private readonly elk: ELK;
  private readonly defaults: LayoutOptions;

  constructor(options: ElkLayoutEngineOptions = {}) {
    this.elk = options.elk ?? new ElkConstructor();
    this.defaults = { ...DEFAULT_LAYOUT_OPTIONS, ...(options.layoutOptions ?? {}) };
  }

  async layout(graph: GraphModel): Promise<LaidOutGraph> {
    const algorithm = ALGORITHM_BY_TYPE[graph.diagramType ?? 'auto'];
    const layoutOptions: LayoutOptions = {
      ...this.defaults,
      'elk.algorithm': algorithm,
      ...(graph.layoutOptions ?? {}),
    };

    const rootNode: ElkNode = {
      id: graph.id,
      layoutOptions,
      children: graph.children.map(toElkNode),
      edges: graph.edges.map(toElkEdge),
    };

    const result = await this.elk.layout(rootNode);
    return fromElkResult(graph, result);
  }
}

function toElkNode(node: GraphNode): ElkNode {
  const elk: ElkNode = {
    id: node.id,
    width: node.width ?? DEFAULT_NODE_WIDTH,
    height: node.height ?? DEFAULT_NODE_HEIGHT,
  };
  if (node.fixedPosition !== undefined) {
    elk.x = node.fixedPosition.x;
    elk.y = node.fixedPosition.y;
    elk.layoutOptions = {
      'elk.position': `(${node.fixedPosition.x},${node.fixedPosition.y})`,
    };
  }
  if (node.children !== undefined) {
    elk.children = node.children.map(toElkNode);
  }
  if (node.ports !== undefined) {
    elk.ports = node.ports.map(toElkPort);
  }
  return elk;
}

function toElkPort(port: GraphPort): ElkPort {
  const elk: ElkPort = { id: port.id };
  if (port.side !== undefined) {
    elk.layoutOptions = { 'elk.port.side': port.side.toUpperCase() };
  }
  return elk;
}

function toElkEdge(edge: GraphEdge): ElkExtendedEdge {
  return {
    id: edge.id,
    sources: [edge.sourcePort ?? edge.source],
    targets: [edge.targetPort ?? edge.target],
  };
}

function fromElkResult(original: GraphModel, result: ElkNode): LaidOutGraph {
  const originalNodes = flattenGraphNodes(original.children);
  const originalEdges = new Map(original.edges.map((edge) => [edge.id, edge]));

  const laidOut: LaidOutGraph = {
    ...original,
    children: (result.children ?? []).map((child) => hydrateNode(child, originalNodes)),
    edges: (result.edges ?? []).map((edge) => hydrateEdge(edge, originalEdges)),
  };
  return laidOut;
}

function flattenGraphNodes(nodes: readonly GraphNode[]): Map<string, GraphNode> {
  const map = new Map<string, GraphNode>();
  const walk = (list: readonly GraphNode[]): void => {
    for (const node of list) {
      map.set(node.id, node);
      if (node.children !== undefined) walk(node.children);
    }
  };
  walk(nodes);
  return map;
}

function hydrateNode(
  elkNode: ElkNode,
  originals: Map<string, GraphNode>,
): LaidOutNode {
  const original = originals.get(elkNode.id);
  if (original === undefined) {
    throw new Error(
      `ELK returned node "${elkNode.id}" that was absent from the input graph`,
    );
  }
  // Strip `children` before spreading: the original's children are
  // unlaid `GraphNode[]`, which `exactOptionalPropertyTypes` refuses
  // to widen into `LaidOutNode[]` even though the overwrite below
  // would replace the value entirely.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { children: _unlaidChildren, ...rest } = original;
  const laidOut: LaidOutNode = {
    ...rest,
    x: elkNode.x ?? 0,
    y: elkNode.y ?? 0,
    width: elkNode.width ?? DEFAULT_NODE_WIDTH,
    height: elkNode.height ?? DEFAULT_NODE_HEIGHT,
  };
  if (elkNode.children !== undefined) {
    laidOut.children = elkNode.children.map((child) => hydrateNode(child, originals));
  }
  return laidOut;
}

function hydrateEdge(
  elkEdge: ElkExtendedEdge,
  originals: Map<string, GraphEdge>,
): LaidOutEdge {
  const original = originals.get(elkEdge.id);
  if (original === undefined) {
    throw new Error(
      `ELK returned edge "${elkEdge.id}" that was absent from the input graph`,
    );
  }
  const laidOut: LaidOutEdge = { ...original };
  if (elkEdge.sections !== undefined) {
    laidOut.sections = elkEdge.sections.map(toLaidOutSection);
  }
  return laidOut;
}

function toLaidOutSection(section: ElkEdgeSection): LaidOutEdgeSection {
  const out: LaidOutEdgeSection = {
    startPoint: clonePoint(section.startPoint),
    endPoint: clonePoint(section.endPoint),
  };
  if (section.bendPoints !== undefined) {
    out.bendPoints = section.bendPoints.map(clonePoint);
  }
  return out;
}

function clonePoint(point: ElkPoint): { x: number; y: number } {
  return { x: point.x, y: point.y };
}
