// Emitter for the LabelBox primitive: one shape (rectangle/ellipse/diamond)
// plus an optional container-bound text child. See docs/03 §95-174.
//
// Pitfall guards exercised here:
//   P4  — autoResize=false when we wrap, width/height driven by measureText
//   P10 — roundness only on rectangle/diamond, never on ellipse
//   C4  — bidirectional boundElements between shape and text

import type { LabelBox } from '../primitives.js';
import { degreesToRadians } from '../utils/angle.js';
import {
  baseElementFields,
  type BaseElementFields,
} from '../utils/baseElementFields.js';
import { newElementId } from '../utils/id.js';
import { getLineHeight, measureText } from '../measure.js';
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
  const shapeId = newElementId();
  const commonBase: BaseElementFields = baseElementFields({
    id: shapeId,
    x: p.at[0] - width / 2,
    y: p.at[1] - height / 2,
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
    const maxTextWidth = Math.max(width - padding * 2, 1);
    const wrapped = wrapText({
      text: p.text,
      maxWidth: maxTextWidth,
      fontSize,
      fontFamily,
    });
    const wrappedMetrics = measureText({
      text: wrapped,
      fontSize,
      fontFamily,
    });

    textId = newElementId();
    const textBase = baseElementFields({
      id: textId,
      x: p.at[0] - wrappedMetrics.width / 2,
      y: p.at[1] - wrappedMetrics.height / 2,
      width: wrappedMetrics.width,
      height: wrappedMetrics.height,
      angle: 0 as Radians,
      strokeColor: style.strokeColor,
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
      // Container-bound text never auto-resizes — width is container-driven. (P4)
      autoResize: false,
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
      x: p.at[0] - width / 2,
      y: p.at[1] - height / 2,
      w: width,
      h: height,
    },
  });
}
