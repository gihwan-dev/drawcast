export * from './primitives.js';
export * from './theme.js';
export * from './compile/index.js';
export * from './types/excalidraw.js';

// Utilities
export { newElementId, newPrimitiveId, randomInteger } from './utils/id.js';
export { degreesToRadians, radiansToDegrees } from './utils/angle.js';
export {
  baseElementFields,
  type BaseElementFields,
} from './utils/baseElementFields.js';

// Font metrics
export {
  EXCALIFONT_METRICS,
  getFontMetrics,
  type FontMetrics,
} from './metrics/fonts.js';

// Text measurement + wrap
export {
  measureText,
  getLineHeight,
  type MeasureParams,
  type TextMetrics,
} from './measure.js';
export { wrapText, type WrapParams } from './wrap.js';

// Emitters (exported for testing; not part of the stable public API).
export { emitLabelBox } from './emit/labelBox.js';
export { emitSticky } from './emit/sticky.js';
export { emitConnector } from './emit/connector.js';
export { emitFrame, applyFrameChildren } from './emit/frame.js';
export { applyGroup } from './emit/group.js';
export { emitLine } from './emit/line.js';
export { emitFreedraw } from './emit/freedraw.js';
export { emitImage } from './emit/image.js';
export { emitEmbed } from './emit/embed.js';
export {
  normalizePoints,
  type NormalizedPoints,
} from './emit/shared/points.js';
