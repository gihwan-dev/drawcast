// Emitter for the Sticky primitive: a free (container-less) text element.
// See docs/03 §234-289.
//
// Pitfall guards:
//   P4 — `autoResize` must match how we set width/text:
//        - explicit width -> wrap + autoResize:false
//        - no width       -> measure raw + autoResize:true

import type { Sticky } from '../primitives.js';
import type { Radians } from '../primitives.js';
import { degreesToRadians } from '../utils/angle.js';
import { baseElementFields } from '../utils/baseElementFields.js';
import { newElementId } from '../utils/id.js';
import { getLineHeight, measureText } from '../measure.js';
import { wrapText } from '../wrap.js';
import type { ExcalidrawTextElement } from '../types/excalidraw.js';
import type { CompileContext } from '../compile/context.js';
import { resolveNodeStyle } from '../compile/resolveStyle.js';

export function emitSticky(p: Sticky, ctx: CompileContext): void {
  // Stickies don't have a shape around them — we still resolve a node style
  // so theme colours can flow through (strokeColor used as text colour).
  const style = resolveNodeStyle(p.style, ctx.theme, p.id, ctx);

  const fontFamily = p.fontFamily ?? style.fontFamily ?? ctx.theme.defaultFontFamily;
  const fontSize = p.fontSize ?? style.fontSize ?? ctx.theme.defaultFontSize;
  const lineHeight = getLineHeight(fontFamily);

  let text: string;
  let width: number;
  let height: number;
  let autoResize: boolean;

  if (p.width !== undefined) {
    // Fixed width: wrap to fit.
    autoResize = false;
    width = p.width;
    text = wrapText({ text: p.text, maxWidth: width, fontSize, fontFamily });
    const m = measureText({ text, fontSize, fontFamily });
    height = m.height;
  } else {
    // Auto: no wrapping, let Excalidraw auto-grow.
    autoResize = true;
    text = p.text;
    const m = measureText({ text: p.text, fontSize, fontFamily });
    width = m.width;
    height = m.height;
  }

  const id = newElementId();
  const base = baseElementFields({
    id,
    x: p.at[0],
    y: p.at[1],
    width,
    height,
    angle: degreesToRadians(p.angle ?? 0),
    strokeColor: style.strokeColor,
    backgroundColor: 'transparent',
    fillStyle: style.fillStyle,
    strokeWidth: style.strokeWidth,
    strokeStyle: style.strokeStyle,
    roughness: style.roughness,
    opacity: p.opacity ?? 100,
    roundness: null,
    locked: p.locked ?? false,
    link: p.link ?? null,
    ...(p.customData !== undefined ? { customData: p.customData } : {}),
  });

  const element: ExcalidrawTextElement = {
    ...base,
    type: 'text',
    angle: base.angle as Radians,
    text,
    originalText: p.text,
    fontSize,
    fontFamily,
    textAlign: p.textAlign ?? 'left',
    verticalAlign: 'top',
    containerId: null,
    lineHeight,
    autoResize,
  };

  ctx.emit(element);
  ctx.registerPrimitive(p.id, {
    kind: 'sticky',
    elementIds: [id],
    primaryId: id,
    bbox: { x: p.at[0], y: p.at[1], w: width, h: height },
  });
}
