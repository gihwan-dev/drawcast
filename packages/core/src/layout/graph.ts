// Graph model — an Excalidraw-agnostic representation of "nodes and their
// relations" that layout engines can consume without knowing how the result
// will be rendered. Mirrors ELK's vocabulary (children, edges, ports,
// layoutOptions) so the first engine binding in engine.ts can translate
// directly without an intermediate shape.
//
// Kept intentionally structural: nothing here imports from ./emit/ or
// ./compile/. Primitive ids flow through `primitiveIds` so the layout
// result can be applied back to a Scene without the layout layer needing
// to understand Connector/LabelBox/Frame semantics.

import type { PrimitiveId } from '../primitives.js';

/** Supported diagram archetypes. Each maps to a preferred ELK algorithm
 *  (see engine.ts). `auto` asks the engine to guess from graph shape. */
export type DiagramType =
  | 'flowchart'
  | 'tree'
  | 'mindmap'
  | 'class'
  | 'er'
  | 'architecture'
  | 'sequence'
  | 'auto';

/** Edge path style hint. ELK maps these to `elk.edgeRouting` option values. */
export type EdgeRouting = 'orthogonal' | 'polyline' | 'splines';

/** Semantic edge protocol. Theme maps these to concrete stroke styles
 *  (solid/dashed/width). Added here so the graph layer stays decoupled
 *  from any theme implementation. */
export type EdgeProtocol =
  | 'sync'
  | 'async'
  | 'stream'
  | 'batch'
  | 'data'
  | 'control';

/** Cardinal port sides. Matches ELK `port.side`. */
export type PortSide = 'north' | 'east' | 'south' | 'west';

export interface GraphPort {
  id: string;
  side?: PortSide;
}

export interface GraphNode {
  id: string;
  /** Back-pointer to the source primitives. Populated when this node was
   *  built from a Scene so `applyLayoutToScene` can find what to update. */
  primitiveIds: readonly PrimitiveId[];
  /** Layout hint / measured size. When omitted the engine defaults to
   *  configured node spacing. */
  width?: number;
  height?: number;
  /** If set, the engine treats this node as positionally locked — i.e.
   *  the scene primitive arrived with an explicit `at`. */
  fixedPosition?: { x: number; y: number };
  /** Semantic kind (e.g. 'aws.rds', 'redis'). Consumed by architecture
   *  diagrams for icon lookup and edge-style defaults. */
  kind?: string;
  /** Nested compound graph. Maps to Frame-bound primitives in the Scene. */
  children?: GraphNode[];
  ports?: GraphPort[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  routing?: EdgeRouting;
  protocol?: EdgeProtocol;
}

export interface GraphModel {
  /** Scene-level id. Not user-visible; exists so a single process can
   *  keep multiple pending layouts straight. */
  id: string;
  diagramType?: DiagramType;
  children: GraphNode[];
  edges: GraphEdge[];
  /** Free-form ELK overrides. Documented downstream; kept open here so
   *  future algorithm additions don't require a type change. */
  layoutOptions?: Record<string, string>;
}
