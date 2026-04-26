// Size measurement for labelBox -> GraphNode. Regression coverage for
// #36: when an LLM emits a labelBox with text but no explicit size, the
// layout layer must reserve enough room for the emitted glyph run so the
// emit path's container-bound text never overflows.

import { describe, expect, it } from 'vitest';
import { buildGraphModel } from '../src/layout/buildGraphModel.js';
import { measureText } from '../src/measure.js';
import { sketchyTheme } from '../src/theme.js';
import type {
  LabelBox,
  Primitive,
  PrimitiveId,
  Scene,
} from '../src/primitives.js';

const PADDING = 20;
const MIN_W = 80;
const MIN_H = 40;

function makeScene(primitives: Primitive[]): Scene {
  return {
    primitives: new Map(primitives.map((p) => [p.id, p])),
    theme: sketchyTheme,
  };
}

function node(id: string, graph: ReturnType<typeof buildGraphModel>) {
  if (graph === null) throw new Error('expected non-null GraphModel');
  const found = graph.children.find((n) => n.id === id);
  if (found === undefined) throw new Error(`node ${id} missing from graph`);
  return found;
}

describe('buildGraphModel — labelBox size measurement', () => {
  it('measures text and pads when size is omitted (rectangle)', () => {
    const box: LabelBox = {
      kind: 'labelBox',
      id: 'r' as PrimitiveId,
      shape: 'rectangle',
      text: '이메일 / 비밀번호 입력',
    };
    const graph = buildGraphModel(makeScene([box]));
    const n = node('r', graph);

    const metrics = measureText({
      text: box.text!,
      fontSize: sketchyTheme.defaultFontSize,
      fontFamily: sketchyTheme.defaultFontFamily,
    });
    expect(n.width).toBe(Math.max(metrics.width + PADDING * 2, MIN_W));
    expect(n.height).toBe(Math.max(metrics.height + PADDING * 2, MIN_H));
  });

  it('inflates ellipse / diamond so the inscribed rectangle fits text + padding', () => {
    const ellipse: LabelBox = {
      kind: 'labelBox',
      id: 'e' as PrimitiveId,
      shape: 'ellipse',
      text: '시작',
    };
    const diamond: LabelBox = {
      kind: 'labelBox',
      id: 'd' as PrimitiveId,
      shape: 'diamond',
      text: '입력값 검증',
    };
    const graph = buildGraphModel(makeScene([ellipse, diamond]));

    for (const shape of ['e', 'd'] as const) {
      const n = node(shape, graph);
      const metrics = measureText({
        text: shape === 'e' ? ellipse.text! : diamond.text!,
        fontSize: sketchyTheme.defaultFontSize,
        fontFamily: sketchyTheme.defaultFontFamily,
      });
      const rectW = Math.max(metrics.width + PADDING * 2, MIN_W);
      const rectH = Math.max(metrics.height + PADDING * 2, MIN_H);
      // Must at least leave room for the inscribed rectangle; √2 is the
      // tightest safe ratio.
      expect(n.width).toBeGreaterThanOrEqual(Math.ceil(rectW * Math.SQRT2));
      expect(n.height).toBeGreaterThanOrEqual(Math.ceil(rectH * Math.SQRT2));
    }
  });

  it('falls back to min dimensions when text is empty', () => {
    const box: LabelBox = {
      kind: 'labelBox',
      id: 'blank' as PrimitiveId,
      shape: 'rectangle',
      text: '',
    };
    const graph = buildGraphModel(makeScene([box]));
    const n = node('blank', graph);
    expect(n.width).toBe(MIN_W);
    expect(n.height).toBe(MIN_H);
  });

  it('honours an explicit width but grows height so wrapped text fits', () => {
    const box: LabelBox = {
      kind: 'labelBox',
      id: 'sized' as PrimitiveId,
      shape: 'rectangle',
      size: [200, 80],
      text: 'x'.repeat(500), // huge text — wraps many times at width 200
    };
    const graph = buildGraphModel(makeScene([box]));
    const n = node('sized', graph);
    // Width stays pinned so the caller's horizontal layout intent is kept.
    expect(n.width).toBe(200);
    // Height grows so ELK reserves enough vertical space for the wrapped
    // glyph run; otherwise the emitted text spills past the reserved box
    // and collides with neighbouring nodes/edge labels.
    expect(n.height).toBeGreaterThan(80);
  });

  it('keeps the declared height when the text already fits', () => {
    const box: LabelBox = {
      kind: 'labelBox',
      id: 'snug' as PrimitiveId,
      shape: 'rectangle',
      fit: 'fixed',
      size: [120, 40],
      text: 'ok',
    };
    const graph = buildGraphModel(makeScene([box]));
    const n = node('snug', graph);
    expect(n.width).toBe(120);
    expect(n.height).toBe(40);
  });

  it('uses the fixed-fit fallback when fit:"fixed" arrives without size', () => {
    const box: LabelBox = {
      kind: 'labelBox',
      id: 'fixedless' as PrimitiveId,
      shape: 'rectangle',
      fit: 'fixed',
      text: 'anything',
    };
    const graph = buildGraphModel(makeScene([box]));
    const n = node('fixedless', graph);
    // Mirrors emit/labelBox.ts FIXED_FALLBACK_W / FIXED_FALLBACK_H.
    expect(n.width).toBe(150);
    expect(n.height).toBe(60);
  });

  it('widens a fixed-size box when a non-CJK token would be hard-broken', () => {
    // Regression guard for state-tcp-02 eval: Claude emitted the
    // "SYN_RECEIVED" state node with fit:'fixed' size [160, 55], but the
    // 12-glyph identifier measured ~132px and the 2*20 padding pushed
    // the single-line width past 160. `wrapText.hardBreak` then chopped
    // the token mid-glyph ("SYN_RECEIV\nED"), which rubric reviewers
    // flagged as unreadable. Force the box to grow so the token stays
    // on one line.
    const box: LabelBox = {
      kind: 'labelBox',
      id: 'syn' as PrimitiveId,
      shape: 'rectangle',
      fit: 'fixed',
      size: [160, 55],
      text: 'SYN_RECEIVED',
    };
    const graph = buildGraphModel(makeScene([box]));
    const n = node('syn', graph);
    const tokenWidth = measureText({
      text: 'SYN_RECEIVED',
      fontSize: sketchyTheme.defaultFontSize,
      fontFamily: sketchyTheme.defaultFontFamily,
    }).width;
    // Width must fit the token plus the standard 2*20 padding on each
    // side so `wrapText` with maxWidth = width - 40 keeps it on one line.
    expect(n.width).toBeGreaterThanOrEqual(tokenWidth + PADDING * 2);
  });

  it('does not inflate width when the token is a pathologically long run', () => {
    // Safety rail for the widening rule above: a caller who passes a
    // narrow box with a single huge token (e.g. a 500-char filler
    // string, long URL, etc.) is signalling "wrap inside this width",
    // not "make the box 20x wider". Cap expansion at 2× declared width.
    const box: LabelBox = {
      kind: 'labelBox',
      id: 'narrow-wrap' as PrimitiveId,
      shape: 'rectangle',
      size: [200, 80],
      text: 'x'.repeat(500),
    };
    const graph = buildGraphModel(makeScene([box]));
    const n = node('narrow-wrap', graph);
    expect(n.width).toBe(200);
  });

  it('derives fixedPosition from `at` using the measured size', () => {
    const box: LabelBox = {
      kind: 'labelBox',
      id: 'anchored' as PrimitiveId,
      shape: 'rectangle',
      at: [500, 300],
      text: 'hi',
    };
    const graph = buildGraphModel(makeScene([box]));
    const n = node('anchored', graph);
    expect(n.fixedPosition).toBeDefined();
    expect(n.fixedPosition!.x).toBe(500 - n.width! / 2);
    expect(n.fixedPosition!.y).toBe(300 - n.height! / 2);
  });

  // Regression guard for seq-oauth-01 eval: Claude emitted a sequence
  // diagram with 4 participant headers and 4 tall/thin lifeline boxes
  // (size [4, 1220]). ELK's layered algorithm then promoted those
  // lifelines to their own columns and stacked the participant headers
  // at the lifelines' vertical midpoint, destroying the "actors on top
  // / messages below" structure. Rail-shaped LabelBoxes now short-
  // circuit graph building so the sync compile path preserves `at`.
  it('returns null when the scene contains a rail-shaped LabelBox (lifeline / divider)', () => {
    const header: LabelBox = {
      kind: 'labelBox',
      id: 'user_hdr' as PrimitiveId,
      shape: 'rectangle',
      fit: 'fixed',
      size: [140, 60],
      at: [50, 0],
      text: '사용자',
    };
    const lifeline: LabelBox = {
      kind: 'labelBox',
      id: 'user_life' as PrimitiveId,
      shape: 'rectangle',
      fit: 'fixed',
      size: [4, 1220],
      at: [118, 70],
      text: '',
    };
    const graph = buildGraphModel(makeScene([header, lifeline]));
    expect(graph).toBeNull();
  });

  it('keeps normal-shape scenes in scope (no rail → non-null graph)', () => {
    const a: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      fit: 'fixed',
      size: [140, 60],
      text: 'A',
    };
    const b: LabelBox = {
      kind: 'labelBox',
      id: 'b' as PrimitiveId,
      shape: 'rectangle',
      fit: 'fixed',
      size: [140, 60],
      text: 'B',
    };
    const graph = buildGraphModel(makeScene([a, b]));
    expect(graph).not.toBeNull();
    expect(graph!.children).toHaveLength(2);
  });

  // Regression guard for the seq-oauth-01 follow-up: when a scene has
  // multiple LabelBoxes pinned with explicit `at` and *no* id-bound
  // connectors among them — only raw-Point arrows for lifelines and
  // messages — ELK's `layered` algorithm rearranges the nodes ignoring
  // the `elk.position` hint because it has no edge structure to layer
  // around. Trust the LLM's positional intent and short-circuit so the
  // sync compile path keeps the declared `at`. Hand-laid sequence
  // diagrams (actor row + lifelines + messages-as-points) end up here.
  it('returns null when pinned LabelBoxes have no id-bound edges between them', () => {
    const user: LabelBox = {
      kind: 'labelBox',
      id: 'user' as PrimitiveId,
      shape: 'rectangle',
      fit: 'fixed',
      size: [140, 55],
      at: [80, 50],
      text: '사용자',
    };
    const auth: LabelBox = {
      kind: 'labelBox',
      id: 'auth' as PrimitiveId,
      shape: 'rectangle',
      fit: 'fixed',
      size: [210, 55],
      at: [570, 50],
      text: 'Authorization Server',
    };
    const message = {
      kind: 'connector' as const,
      id: 'M1' as PrimitiveId,
      from: [80, 200] as const,
      to: [570, 200] as const,
      label: '인증요청',
    };
    const graph = buildGraphModel(makeScene([user, auth, message]));
    expect(graph).toBeNull();
  });

  it('keeps the graph live when at least one connector binds two LabelBoxes by id', () => {
    const a: LabelBox = {
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      fit: 'fixed',
      size: [140, 60],
      at: [100, 100],
      text: 'A',
    };
    const b: LabelBox = {
      kind: 'labelBox',
      id: 'b' as PrimitiveId,
      shape: 'rectangle',
      fit: 'fixed',
      size: [140, 60],
      at: [400, 100],
      text: 'B',
    };
    const link = {
      kind: 'connector' as const,
      id: 'a_b' as PrimitiveId,
      from: 'a' as PrimitiveId,
      to: 'b' as PrimitiveId,
    };
    const graph = buildGraphModel(makeScene([a, b, link]));
    expect(graph).not.toBeNull();
    expect(graph!.edges).toHaveLength(1);
  });
});
