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

// Serialization (Phase 1.5).
export {
  serializeAsExcalidrawFile,
  serializeAsClipboardJSON,
  serializeAsObsidianMarkdown,
  type ExcalidrawFileEnvelope,
  type ExcalidrawClipboardEnvelope,
  type SerializeOptions,
} from './serialize.js';

// Compliance runner (Phase 1.6).
export {
  runCompliance,
  type ComplianceIssue,
  type ComplianceReport,
  type ComplianceCode,
} from './testing/compliance.js';

// Layout engine (Phase 2, Node-only). Gated behind DRAWCAST_LAYOUT_ENGINE.
export {
  compileAsync,
  type CompileAsyncOptions,
  ElkLayoutEngine,
  type ElkLayoutEngineOptions,
  buildGraphModel,
  type BuildGraphModelOptions,
  applyLayoutToScene,
  type DiagramType,
  type EdgeProtocol,
  type EdgeRouting,
  type GraphEdge,
  type GraphModel,
  type GraphNode,
  type GraphPort,
  type LaidOutEdge,
  type LaidOutEdgeSection,
  type LaidOutGraph,
  type LaidOutNode,
  type LayoutEngine,
  type PortSide,
} from './layout/index.js';
