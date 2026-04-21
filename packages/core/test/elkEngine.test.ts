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
