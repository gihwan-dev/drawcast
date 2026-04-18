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
