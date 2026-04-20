import type {
  EvalQuestion,
  ExcalidrawElement,
  ExcalidrawScene,
  MetricsResult,
} from './types.js';

const NODE_TYPES = new Set(['rectangle', 'diamond', 'ellipse', 'text']);
const EDGE_TYPES = new Set(['arrow', 'line']);

interface Box {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function calculateMetrics(
  scene: ExcalidrawScene,
  question: EvalQuestion,
): MetricsResult {
  const elements = liveElements(scene);
  const nodeElements = elements.filter(isNodeElement);
  const edgeElements = elements.filter((element) => EDGE_TYPES.has(element.type));
  const labels = collectLabels(elements);
  const graph = buildGraph(edgeElements);

  const metrics: MetricsResult = {
    node_count: nodeElements.length,
    edge_count: edgeElements.length,
    node_count_fit: inRange(nodeElements.length, question.expected.node_count),
    edge_count_fit: inRange(edgeElements.length, question.expected.edge_count),
    concept_coverage: calculateConceptCoverage(
      question.expected.required_concepts,
      labels,
    ),
    overlap_pairs: countOverlaps(nodeElements),
  };

  if (question.expected.must_have_branch === true) {
    metrics.has_branch = [...graph.outgoing.values()].some(
      (targets) => targets.size >= 2,
    );
  }
  if (question.expected.must_have_loop === true) {
    metrics.has_loop = hasCycle(graph.outgoing);
  }
  return metrics;
}

function liveElements(scene: ExcalidrawScene): ExcalidrawElement[] {
  return scene.elements.filter((element) => element.isDeleted !== true);
}

function isNodeElement(element: ExcalidrawElement): boolean {
  if (!NODE_TYPES.has(element.type)) {
    return false;
  }
  return element.type !== 'text' || element.containerId == null;
}

function inRange(value: number, range: { min: number; max: number }): 0 | 1 {
  return value >= range.min && value <= range.max ? 1 : 0;
}

function collectLabels(elements: readonly ExcalidrawElement[]): string[] {
  return elements
    .filter((element) => element.type === 'text')
    .flatMap((element) => [element.text, element.originalText])
    .filter((value): value is string => typeof value === 'string')
    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
}

function calculateConceptCoverage(
  requiredConcepts: readonly string[],
  labels: readonly string[],
): number {
  if (requiredConcepts.length === 0) {
    return 1;
  }
  const normalizedLabels = labels.map(normalizeText);
  const covered = requiredConcepts.filter((concept) => {
    const normalizedConcept = normalizeText(concept);
    return normalizedLabels.some((label) => label.includes(normalizedConcept));
  });
  return round(covered.length / requiredConcepts.length);
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, '');
}

function countOverlaps(elements: readonly ExcalidrawElement[]): number {
  const boxes = elements.map(toBox);
  let count = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    const left = boxes[i];
    if (left === undefined) {
      continue;
    }
    for (let j = i + 1; j < boxes.length; j += 1) {
      const right = boxes[j];
      if (right !== undefined && intersects(left, right)) {
        count += 1;
      }
    }
  }
  return count;
}

function toBox(element: ExcalidrawElement): Box {
  return {
    id: element.id,
    x1: element.x,
    y1: element.y,
    x2: element.x + Math.max(0, element.width),
    y2: element.y + Math.max(0, element.height),
  };
}

function intersects(left: Box, right: Box): boolean {
  return (
    left.id !== right.id &&
    left.x1 < right.x2 &&
    left.x2 > right.x1 &&
    left.y1 < right.y2 &&
    left.y2 > right.y1
  );
}

function buildGraph(edgeElements: readonly ExcalidrawElement[]): {
  outgoing: Map<string, Set<string>>;
} {
  const outgoing = new Map<string, Set<string>>();
  for (const edge of edgeElements) {
    const from = edge.startBinding?.elementId;
    const to = edge.endBinding?.elementId;
    if (typeof from !== 'string' || typeof to !== 'string') {
      continue;
    }
    const targets = outgoing.get(from) ?? new Set<string>();
    targets.add(to);
    outgoing.set(from, targets);
  }
  return { outgoing };
}

function hasCycle(graph: Map<string, Set<string>>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(node: string): boolean {
    if (visiting.has(node)) {
      return true;
    }
    if (visited.has(node)) {
      return false;
    }
    visiting.add(node);
    for (const next of graph.get(node) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  for (const node of graph.keys()) {
    if (visit(node)) {
      return true;
    }
  }
  return false;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
