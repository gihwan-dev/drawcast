// Public API for `@drawcast/mcp-server`.
//
// Consumers typically only need `createServer` + a transport binder. The
// `SceneStore` and error class are exported so the app package can share a
// store in sidecar mode and for testing.

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

export const VERSION = '0.0.0';
