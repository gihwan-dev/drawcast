// Smoke tests for the real elkjs binding. Hitting the actual ELK
// instance — not a mock — gives us three things at once:
//   (1) proves the bundled entry loads in the Node test runtime,
//   (2) pins the ELK-in / ELK-out coordinate contract we feed
//       `applyLayoutToScene` in a later commit,
//   (3) guards determinism (randomSeed=1) from algorithm upgrades.

import { describe, expect, it } from 'vitest';
import { ElkLayoutEngine } from '../src/layout/elkEngine.js';
import type { GraphModel } from '../src/layout/graph.js';

function lineGraph(): GraphModel {
  return {
    id: 'scene',
    diagramType: 'flowchart',
    children: [
      { id: 'a', primitiveIds: ['box-a'], width: 120, height: 60 },
      { id: 'b', primitiveIds: ['box-b'], width: 120, height: 60 },
      { id: 'c', primitiveIds: ['box-c'], width: 120, height: 60 },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ],
  };
}

describe('ElkLayoutEngine', () => {
  it('assigns x/y to every node and preserves primitiveIds round-trip', async () => {
    const engine = new ElkLayoutEngine();
    const result = await engine.layout(lineGraph());

    expect(result.children).toHaveLength(3);
    for (const node of result.children) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
      expect(node.primitiveIds.length).toBeGreaterThan(0);
    }
  });

  it('layered + DOWN flowchart lays out a 3-node chain top-to-bottom', async () => {
    const engine = new ElkLayoutEngine();
    const result = await engine.layout(lineGraph());
    const byId = new Map(result.children.map((node) => [node.id, node]));
    const a = byId.get('a')!;
    const b = byId.get('b')!;
    const c = byId.get('c')!;
    // With `elk.direction: DOWN` each successor sits below its predecessor.
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
  });

  it('emits orthogonal edge sections with start/end points', async () => {
    const engine = new ElkLayoutEngine();
    const result = await engine.layout(lineGraph());
    const edge = result.edges.find((candidate) => candidate.id === 'e1');
    expect(edge).toBeDefined();
    expect(edge!.sections).toBeDefined();
    const section = edge!.sections![0]!;
    expect(section.startPoint).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
    });
    expect(section.endPoint).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
    });
  });

  it('is deterministic given a fixed input (randomSeed pinned)', async () => {
    const engine = new ElkLayoutEngine();
    const [first, second] = await Promise.all([
      engine.layout(lineGraph()),
      engine.layout(lineGraph()),
    ]);
    for (const id of ['a', 'b', 'c']) {
      const firstNode = first.children.find((node) => node.id === id)!;
      const secondNode = second.children.find((node) => node.id === id)!;
      expect(firstNode.x).toBe(secondNode.x);
      expect(firstNode.y).toBe(secondNode.y);
    }
  });

  it('anchors source nodes to the top layer even when a retry loop targets an early node', async () => {
    // Regression guard for the eval finding that "start" nodes landed at
    // the bottom of flowcharts containing a retry loop (e.g. a "retry?"
    // decision node edge that targets the input node). With ELK's default
    // NETWORK_SIMPLEX layering the source could be demoted to a lower
    // layer because that minimises total edge length; LONGEST_PATH_SOURCE
    // pins it to layer 0.
    const engine = new ElkLayoutEngine();
    const graph: GraphModel = {
      id: 'scene',
      diagramType: 'flowchart',
      children: [
        { id: 'start', primitiveIds: ['start'], width: 120, height: 60 },
        { id: 'input', primitiveIds: ['input'], width: 120, height: 60 },
        { id: 'decide', primitiveIds: ['decide'], width: 120, height: 60 },
        { id: 'retry', primitiveIds: ['retry'], width: 120, height: 60 },
        { id: 'done', primitiveIds: ['done'], width: 120, height: 60 },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'input' },
        { id: 'e2', source: 'input', target: 'decide' },
        { id: 'e3', source: 'decide', target: 'retry' },
        { id: 'e4', source: 'decide', target: 'done' },
        { id: 'e5', source: 'retry', target: 'input' },
      ],
    };
    const result = await engine.layout(graph);
    const byId = new Map(result.children.map((n) => [n.id, n]));
    const start = byId.get('start')!;
    for (const id of ['input', 'decide', 'retry', 'done']) {
      const other = byId.get(id)!;
      expect(start.y).toBeLessThan(other.y);
    }
  });

  it('keeps the forward edge pointing down when multiple retry loops converge on an early node', async () => {
    // Regression guard for the eval finding that flowcharts with two
    // independent retry loops (validation retry + auth-failure retry)
    // both targeting the "input" node caused ELK's GREEDY cycle
    // breaking to reverse the single forward edge `input → validate`
    // (since removing it breaks both cycles with one cut). That
    // promoted `validate` to a source layer and buried `input` at
    // the bottom. INTERACTIVE cycle breaking uses the y hint from
    // `fixedPosition` to classify back edges instead.
    const engine = new ElkLayoutEngine();
    const graph: GraphModel = {
      id: 'scene',
      diagramType: 'flowchart',
      children: [
        {
          id: 'start',
          primitiveIds: ['start'],
          width: 120,
          height: 60,
          fixedPosition: { x: 400, y: 50 },
        },
        {
          id: 'input',
          primitiveIds: ['input'],
          width: 120,
          height: 60,
          fixedPosition: { x: 400, y: 210 },
        },
        {
          id: 'validate',
          primitiveIds: ['validate'],
          width: 120,
          height: 60,
          fixedPosition: { x: 400, y: 370 },
        },
        {
          id: 'invalid_msg',
          primitiveIds: ['invalid_msg'],
          width: 120,
          height: 60,
          fixedPosition: { x: 150, y: 530 },
        },
        {
          id: 'auth',
          primitiveIds: ['auth'],
          width: 120,
          height: 60,
          fixedPosition: { x: 400, y: 530 },
        },
        {
          id: 'auth_check',
          primitiveIds: ['auth_check'],
          width: 120,
          height: 60,
          fixedPosition: { x: 400, y: 690 },
        },
        {
          id: 'fail',
          primitiveIds: ['fail'],
          width: 120,
          height: 60,
          fixedPosition: { x: 150, y: 850 },
        },
        {
          id: 'success',
          primitiveIds: ['success'],
          width: 120,
          height: 60,
          fixedPosition: { x: 630, y: 850 },
        },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'input' },
        { id: 'e2', source: 'input', target: 'validate' },
        { id: 'e3', source: 'validate', target: 'invalid_msg' },
        { id: 'e4', source: 'validate', target: 'auth' },
        { id: 'e5', source: 'auth', target: 'auth_check' },
        { id: 'e6', source: 'auth_check', target: 'success' },
        { id: 'e7', source: 'auth_check', target: 'fail' },
        { id: 'e8', source: 'invalid_msg', target: 'input' },
        { id: 'e9', source: 'fail', target: 'input' },
      ],
    };
    const result = await engine.layout(graph);
    const byId = new Map(result.children.map((n) => [n.id, n]));
    const start = byId.get('start')!;
    const input = byId.get('input')!;
    const validate = byId.get('validate')!;
    // The forward chain must flow downward. INTERACTIVE cycle breaking
    // pins `input` above `validate`; GREEDY would swap them by
    // reversing `input → validate`.
    expect(start.y).toBeLessThan(input.y);
    expect(input.y).toBeLessThan(validate.y);
    // Every other node stays below `input` too, i.e. the retry targets
    // do not bury the loop-back target.
    for (const id of ['invalid_msg', 'auth', 'auth_check', 'fail', 'success']) {
      expect(input.y).toBeLessThan(byId.get(id)!.y);
    }
  });

  it('accepts fixedPosition input without failing layout', async () => {
    // Layered algorithm recomputes positions globally and only treats
    // `elk.position` as a soft hint, so we don't yet guarantee the
    // laid-out node matches the requested coords. The hard-fixed path
    // is planned for Phase 3 via the `fixed` / interactive algorithm.
    // For now just check the engine doesn't crash and still returns
    // finite coordinates for the pinned node.
    const engine = new ElkLayoutEngine();
    const graph: GraphModel = {
      id: 'scene',
      diagramType: 'flowchart',
      children: [
        {
          id: 'pinned',
          primitiveIds: ['p'],
          width: 100,
          height: 40,
          fixedPosition: { x: 500, y: 200 },
        },
        { id: 'free', primitiveIds: ['f'], width: 100, height: 40 },
      ],
      edges: [{ id: 'e', source: 'pinned', target: 'free' }],
    };
    const result = await engine.layout(graph);
    const pinned = result.children.find((node) => node.id === 'pinned')!;
    expect(Number.isFinite(pinned.x)).toBe(true);
    expect(Number.isFinite(pinned.y)).toBe(true);
    expect(pinned.primitiveIds).toEqual(['p']);
  });
});
