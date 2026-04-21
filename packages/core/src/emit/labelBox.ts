// Emitter for the LabelBox primitive: one shape (rectangle/ellipse/diamond)
// plus an optional container-bound text child. See docs/03 §95-174.
//
// Pitfall guards exercised here:
//   P10 — roundness only on rectangle/diamond, never on ellipse
//   C4  — bidirectional boundElements between shape and text
//
// Excalidraw 0.17.x quirks baked into the geometry choices below:
//   - `baseline` is a REQUIRED field on text elements (0.18+ makes it
//     optional + computed); omitting it leaves the label invisible.
//   - `autoResize` does not exist yet; we position + size the text
//     explicitly and Excalidraw's `redrawTextBoundingBox` will re-centre
//     on first interaction without losing visibility in between.

import type { LabelBox } from '../primitives.js';
import { degreesToRadians } from '../utils/angle.js';
import {
  baseElementFields,
  type BaseElementFields,
} from '../utils/baseElementFields.js';
import { pickHighContrastTextColor } from '../utils/contrast.js';
import { newElementId } from '../utils/id.js';
import { getLineHeight, measureText, type TextMetrics } from '../measure.js';
import { wrapText } from '../wrap.js';
import type {
  ExcalidrawDiamondElement,
  ExcalidrawEllipseElement,
  ExcalidrawRectangleElement,
  ExcalidrawTextElement,
  Roundness,
} from '../types/excalidraw.js';
import type { Radians } from '../primitives.js';
import type { CompileContext } from '../compile/context.js';
import { resolveNodeStyle } from '../compile/resolveStyle.js';

/**
 * Approximate the ascent (distance from the top of a line box down to the
 * glyph baseline). Excalidraw 0.17.x stores this on each text element and
 * feeds it into `fillText`; a missing or near-zero value drops the glyph
 * below the clip rect and the label disappears.
 *
 * The ~90% ratio matches Excalifont / Virgil font metrics closely enough
 * that the rendered glyph sits visually centered once `redrawTextBoundingBox`
 * reconciles on first paint.
 */
function approximateBaseline(fontSize: number, lineHeight: number): number {
  return Math.round(fontSize * lineHeight * 0.8);
}

const DEFAULT_PADDING = 20;
// Fallbacks used only when `fit:'fixed'` is requested without a size.
const FIXED_FALLBACK_W = 150;
const FIXED_FALLBACK_H = 60;

type ShapeElement =
  | ExcalidrawRectangleElement
  | ExcalidrawEllipseElement
  | ExcalidrawDiamondElement;

export function emitLabelBox(p: LabelBox, ctx: CompileContext): void {
  const style = resolveNodeStyle(p.style, ctx.theme, p.id, ctx);

  const fontFamily = p.fontFamily ?? style.fontFamily ?? ctx.theme.defaultFontFamily;
  const fontSize = p.fontSize ?? style.fontSize ?? ctx.theme.defaultFontSize;
  const lineHeight = getLineHeight(fontFamily);
  const padding = DEFAULT_PADDING;

  // -- Size determination ------------------------------------------------------
  let width: number;
  let height: number;
  if (p.fit === 'fixed') {
    if (p.size) {
      width = p.size[0];
      height = p.size[1];
    } else {
      ctx.pushWarning({
        code: 'LABELBOX_FIXED_SIZE_MISSING',
        message: `LabelBox ${p.id} has fit:'fixed' but no size; falling back to ${FIXED_FALLBACK_W}x${FIXED_FALLBACK_H}.`,
        primitiveId: p.id,
      });
      width = FIXED_FALLBACK_W;
      height = FIXED_FALLBACK_H;
    }
  } else {
    // 'auto' (default). Measure raw text and pad.
    if (p.text) {
      const metrics = measureText({ text: p.text, fontSize, fontFamily });
      width = Math.max(metrics.width + padding * 2, 80);
      height = Math.max(metrics.height + padding * 2, 40);
    } else {
      width = 80;
      height = 40;
    }
  }

  // Pre-wrap the text and expand the container height if the wrapped glyph
  // run needs more vertical room than the declared box. Callers that pass
  // fit:'fixed' with a height sized for the raw (unwrapped) line count —
  // common with CJK labels that wrap into more lines once width is clamped —
  // would otherwise overflow the shape and collide with neighbouring edge
  // labels (see arch-cdn-03 eval: "PostgreSQL" spilled into a nearby
  // "replicate" label below the Main DB node).
  let prewrappedText: string | undefined;
  let prewrappedMetrics: TextMetrics | undefined;
  if (p.text) {
    const maxTextWidth = Math.max(width - padding * 2, 1);
    prewrappedText = wrapText({
      text: p.text,
      maxWidth: maxTextWidth,
      fontSize,
      fontFamily,
    });
    prewrappedMetrics = measureText({
      text: prewrappedText,
      fontSize,
      fontFamily,
      lineHeight,
    });
    // Only expand when the wrapped text itself would not fit — the caller's
    // declared height already accounts for their preferred padding, so a
    // single-line label in an 80×40 box should stay 80×40 rather than grow
    // to include an extra 20px top/bottom of reserved padding.
    if (prewrappedMetrics.height > height) {
      height = prewrappedMetrics.height + padding * 2;
    }
  }

  // -- Roundness (P10 matrix) --------------------------------------------------
  // rectangle / diamond accept {type:3}. ellipse always null (ignored anyway).
  let roundness: Roundness = null;
  if (p.shape !== 'ellipse') {
    const wantsRounded =
      p.rounded === true ||
      (p.rounded === undefined && style.roundness !== undefined && style.roundness !== null);
    if (wantsRounded) {
      // Prefer explicit preset level when sensible, else default to 3 (adaptive).
      const level = style.roundness === 1 ? 1 : style.roundness === 2 ? 2 : 3;
      roundness = { type: level };
    }
  }

  // -- Shape element -----------------------------------------------------------
  // `at` is optional since Phase 2: when the primitive arrived without
  // explicit coordinates the scene origin is a safe fallback — either
  // the layout engine already rewrote `at` in compileAsync, or the
  // caller is on the sync path and accepts origin placement as an
  // explicit signal that they forgot.
  const [atX, atY] = p.at ?? [0, 0];
  const shapeId = newElementId();
  const commonBase: BaseElementFields = baseElementFields({
    id: shapeId,
    x: atX - width / 2,
    y: atY - height / 2,
    width,
    height,
    angle: degreesToRadians(p.angle ?? 0),
    strokeColor: style.strokeColor,
    backgroundColor: style.backgroundColor,
    fillStyle: style.fillStyle,
    strokeWidth: style.strokeWidth,
    strokeStyle: style.strokeStyle,
    roughness: style.roughness,
    opacity: p.opacity ?? 100,
    roundness,
    locked: p.locked ?? false,
    link: p.link ?? null,
    customData: { ...(p.customData ?? {}), drawcastPrimitiveId: p.id },
  });

  const shape: ShapeElement = {
    ...commonBase,
    type: p.shape,
    angle: commonBase.angle as Radians,
    roundness,
  } as ShapeElement;

  // -- Text child (if any) -----------------------------------------------------
  let textId: string | null = null;
  if (p.text) {
    // Reuse the pre-wrap computed above for the height fit-up decision so
    // the text element and the container stay in lock-step.
    const wrapped =
      prewrappedText ??
      wrapText({
        text: p.text,
        maxWidth: Math.max(width - padding * 2, 1),
        fontSize,
        fontFamily,
      });
    const wrappedMetrics =
      prewrappedMetrics ??
      measureText({
        text: wrapped,
        fontSize,
        fontFamily,
        lineHeight,
      });

    // Size the text element to its measured glyph run (plus a single-pixel
    // safety margin so aliasing doesn't clip edges) and center it inside
    // the container. Excalidraw 0.17.x expects container-bound text to
    // carry a real measured bbox + `baseline`; when those are missing or
    // lie flush with the container rect, `refreshTextDimensions` clamps
    // the run to zero and the label disappears.
    const textWidth = Math.min(wrappedMetrics.width, width);
    const textHeight = Math.min(wrappedMetrics.height, height);
    const textX = commonBase.x + (width - textWidth) / 2;
    const textY = commonBase.y + (height - textHeight) / 2;

    textId = newElementId();
    // The authored stroke often matches the fill's darker shade (e.g.
    // stroke=#2b8a3e on bg=#2f9e44 from Claude's own presets), which
    // renders the bound text barely distinguishable from the shape fill.
    // Drop to a high-contrast fallback whenever the authored pairing
    // falls under WCAG 4.5:1.
    const labelColor = pickHighContrastTextColor(
      style.backgroundColor,
      style.strokeColor,
    );
    const textBase = baseElementFields({
      id: textId,
      x: textX,
      y: textY,
      width: textWidth,
      height: textHeight,
      angle: 0 as Radians,
      strokeColor: labelColor,
      backgroundColor: 'transparent',
      fillStyle: style.fillStyle,
      strokeWidth: style.strokeWidth,
      strokeStyle: style.strokeStyle,
      roughness: style.roughness,
      opacity: p.opacity ?? 100,
      roundness: null,
      locked: p.locked ?? false,
      customData: { drawcastPrimitiveId: p.id },
    });

    const text: ExcalidrawTextElement = {
      ...textBase,
      type: 'text',
      angle: textBase.angle as Radians,
      text: wrapped,
      originalText: p.text,
      fontSize,
      fontFamily,
      textAlign: p.textAlign ?? 'center',
      verticalAlign: p.verticalAlign ?? 'middle',
      containerId: shapeId,
      lineHeight,
      baseline: approximateBaseline(fontSize, lineHeight),
    };

    // Wire the text into the shape's boundElements BEFORE emitting so the
    // shape's boundElements list is correct when `emit` indexes it.
    shape.boundElements = [{ type: 'text', id: textId }];

    // Emit shape first so addBoundElement for later connectors finds it.
    ctx.emit(shape);
    ctx.emit(text);
  } else {
    ctx.emit(shape);
  }

  // -- Registry ---------------------------------------------------------------
  ctx.registerPrimitive(p.id, {
    kind: 'labelBox',
    elementIds: textId ? [shapeId, textId] : [shapeId],
    primaryId: shapeId,
    bbox: {
      x: atX - width / 2,
      y: atY - height / 2,
      w: width,
      h: height,
    },
  });
}
