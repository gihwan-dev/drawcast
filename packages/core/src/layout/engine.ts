// LayoutEngine contract — the boundary every algorithm implementation
// (ELK, custom sequence, future Graphviz binding) must satisfy. The
// contract is purely async because ELK is async-only on browser and
// `compileAsync` funnels everything through this interface; synchronous
// consumers must stay on the legacy `compile` path.
//
// This file intentionally ships interfaces only. The first implementation
// (ElkLayoutEngine) lands in a follow-up commit so the type-level
// scaffolding can be reviewed in isolation.

import type { GraphEdge, GraphModel, GraphNode } from './graph.js';

export interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
  children?: LaidOutNode[];
}

/** A single rectilinear segment of a routed edge. Origin matches ELK's
 *  `ElkEdgeSection`: one segment is usually enough, with bend points
 *  spelling out the corners of an orthogonal path. */
export interface LaidOutEdgeSection {
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  bendPoints?: readonly { x: number; y: number }[];
}

export interface LaidOutEdge extends GraphEdge {
  sections?: readonly LaidOutEdgeSection[];
}

export interface LaidOutGraph extends GraphModel {
  children: LaidOutNode[];
  edges: LaidOutEdge[];
}

export interface LayoutEngine {
  /** Run layout. Must be pure w.r.t. input — two calls with an identical
   *  `GraphModel` return equivalent geometry, so results can be cached
   *  and regressions diffed. */
  layout(graph: GraphModel): Promise<LaidOutGraph>;
}
