// Public API for `@drawcast/mcp-server`.
//
// Consumers typically only need `createServer` + a transport binder. The
// `SceneStore` and error class are exported so the app package can share a
// store in sidecar mode and for testing. Tool definitions are exported so
// callers can register a custom subset or exercise individual tools in
// unit tests.

export {
  createServer,
  type CreateServerOptions,
  type DrawcastServer,
} from './server.js';
export {
  SceneStore,
  SceneLockError,
  type SceneStoreChangeEvent,
} from './store.js';
export { connectStdio } from './transport/stdio.js';
export {
  startSSE,
  type SSEOptions,
  type SSEHandle,
} from './transport/sse.js';
export {
  ScenePersistence,
  type PersistenceOptions,
} from './persistence.js';
export {
  createPreviewBus,
  type PreviewBus,
  type PreviewResponse,
} from './preview-bus.js';

// Tool exports (PR #9 + PR #10 — 14-tool surface; PR #18 extends to 15 by
// adding `draw_get_preview`).
export {
  coreTools,
  registerTools,
  defineTool,
  drawUpsertBox,
  drawUpsertEdge,
  drawUpsertSticky,
  drawUpsertGroup,
  drawUpsertFrame,
  drawUpsertShape,
  drawGetScene,
  drawGetPrimitive,
  drawGetSelection,
  drawListStylePresets,
  drawRemove,
  drawClear,
  drawSetTheme,
  drawExport,
  drawGetPreview,
  type ToolDefinition,
  type ToolDeps,
  type ToolExecutionResult,
  type ToolInputJsonSchema,
} from './tools/index.js';

export const VERSION = '0.0.0';
