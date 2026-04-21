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
import { wrapText } from '../wrap.js';
import type { LabelBox, Primitive, Scene } from '../primitives.js';
import type { Theme } from '../theme.js';
import type { GraphEdge, GraphModel, GraphNode } from './graph.js';

// Kept in sync with emit/labelBox.ts (DEFAULT_PADDING, FIXED_FALLBACK_*)
// so a node sized here survives round-trip through ELK and the emit
// layer without growing or shrinking. A mismatch would show up as the
// emit path re-fitting the shape to a different size than ELK reserved.
const LAYOUT_PADDING = 20;
const MIN_LAYOUT_WIDTH = 80;
const MIN_LAYOUT_HEIGHT = 40;
const FIXED_FALLBACK_WIDTH = 150;
const FIXED_FALLBACK_HEIGHT = 60;
// Ellipse/diamond bounding boxes must be larger than their inscribed
// rectangle, otherwise the emit layer's `maxTextWidth = width - 2*padding`
// clamps wrap to fewer lines than ELK reserved vertical space for and
// the glyph run leaks past the curved/angled edges. √2 matches the
// inscribed-rectangle-in-ellipse ratio; diamond's worst case is the
// same under the (w, h) symmetric assumption emitLabelBox already makes.
const NON_RECT_INFLATION = Math.SQRT2;

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
      const edge = connectorToEdge(primitive, nodeIds, scene.theme);
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
  const { width, height } = measureLabelBoxSize(primitive, theme);
  const node: GraphNode = {
    id: primitive.id,
    primitiveIds: [primitive.id],
    width,
    height,
  };
  // An explicit `at` is the LLM's (or user's) positional intent — pass
  // it to ELK as a fixed-position hint so the layer algorithm tries to
  // respect it. `at` is centre-based; ELK expects top-left, so convert
  // using the measured (not necessarily declared) size. Layered treats
  // `elk.position` as a soft hint today; Phase 3 will introduce the
  // interactive/fixed algorithm for hard pinning.
  if (primitive.at !== undefined) {
    node.fixedPosition = {
      x: primitive.at[0] - width / 2,
      y: primitive.at[1] - height / 2,
    };
  }
  return node;
}

/**
 * Pick a bounding box for a LabelBox before it enters the layout engine.
 *
 * Without this the ELK engine falls back to its generic 160×60 default
 * (see elkEngine.ts DEFAULT_NODE_WIDTH/HEIGHT), which is too small for
 * multi-line Korean labels like "이메일 / 비밀번호 입력" — ELK reserves
 * a box that the emit-layer text node then overflows (#36).
 *
 * The goal is size parity with `emitLabelBox`'s own auto-fit output so
 * a node sized here stays that size after `applyLayoutToScene` pins it
 * via `fit:'fixed'` and the emit layer reads it back.
 */
function measureLabelBoxSize(
  primitive: LabelBox,
  theme: Theme,
): { width: number; height: number } {
  const fontSize = primitive.fontSize ?? theme.defaultFontSize;
  const fontFamily = primitive.fontFamily ?? theme.defaultFontFamily;

  let width: number;
  let height: number;

  if (primitive.fit === 'fixed') {
    // fit:'fixed' pins the declared width through emit. Mirror the emit
    // fallback when size is missing rather than measure (users who opt
    // into fixed are signalling "don't auto-fit" the width).
    if (primitive.size !== undefined) {
      width = primitive.size[0];
      height = primitive.size[1];
    } else {
      width = FIXED_FALLBACK_WIDTH;
      height = FIXED_FALLBACK_HEIGHT;
    }
  } else if (primitive.size !== undefined) {
    // Auto fit but caller handed us an explicit size; don't silently
    // discard it.
    width = primitive.size[0];
    height = primitive.size[1];
  } else if (primitive.text !== undefined && primitive.text !== '') {
    // No size: measure the raw text and pad, matching emitLabelBox's
    // own auto-fit rule. Wrapping isn't applied here — we don't yet
    // know a target max width, so we reserve the whole unwrapped run.
    const metrics = measureText({
      text: primitive.text,
      fontSize,
      fontFamily,
    });
    width = Math.max(metrics.width + LAYOUT_PADDING * 2, MIN_LAYOUT_WIDTH);
    height = Math.max(metrics.height + LAYOUT_PADDING * 2, MIN_LAYOUT_HEIGHT);
  } else {
    width = MIN_LAYOUT_WIDTH;
    height = MIN_LAYOUT_HEIGHT;
  }

  // Guarantee the reserved box can contain the wrapped glyph run. A
  // caller that pins width via fit:'fixed' still expects text to fit;
  // CJK labels frequently wrap into more lines than the raw height was
  // sized for, and without this the emit layer renders text spilling
  // below the shape into nearby edge labels (arch-cdn-03 eval).
  if (primitive.text !== undefined && primitive.text !== '') {
    const maxTextWidth = Math.max(width - LAYOUT_PADDING * 2, 1);
    const wrapped = wrapText({
      text: primitive.text,
      maxWidth: maxTextWidth,
      fontSize,
      fontFamily,
    });
    const wrappedMetrics = measureText({
      text: wrapped,
      fontSize,
      fontFamily,
    });
    // Only expand when the wrapped text itself would not fit — the
    // declared height already includes the caller's preferred padding.
    if (wrappedMetrics.height > height) {
      height = wrappedMetrics.height + LAYOUT_PADDING * 2;
    }
  }

  if (primitive.shape !== 'rectangle') {
    width = Math.ceil(width * NON_RECT_INFLATION);
    height = Math.ceil(height * NON_RECT_INFLATION);
  }
  return { width, height };
}

function connectorToEdge(
  primitive: Extract<Primitive, { kind: 'connector' }>,
  knownNodeIds: ReadonlySet<string>,
  theme: Theme,
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
  const edge: GraphEdge = {
    id: primitive.id,
    source: primitive.from,
    target: primitive.to,
    routing: 'orthogonal',
  };
  // Measure label so ELK's layered algorithm can reserve space for it.
  // Without this the emitted text — which Excalidraw repositions to the
  // arrow midpoint — ends up on top of nearby nodes in dense graphs
  // (e.g. the retry-heavy CI flowchart where multiple "실패" labels
  // cluster around a single "fix & re-push" target).
  if (primitive.label !== undefined && primitive.label !== '') {
    const fontSize = theme.defaultFontSize;
    const fontFamily = theme.defaultFontFamily;
    const metrics = measureText({
      text: primitive.label,
      fontSize,
      fontFamily,
    });
    edge.label = {
      text: primitive.label,
      width: metrics.width,
      height: metrics.height,
    };
  }
  return edge;
}
