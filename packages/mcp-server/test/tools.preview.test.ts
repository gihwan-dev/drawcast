// Behaviour tests for `draw_get_preview`.
//
// The tool is transport-independent — it talks to a PreviewBus. We build
// an in-memory bus stub so we can drive emit/await/has-subscribers
// branches without booting the SSE HTTP server. A separate assertion in
// the SSE test suite covers the wired-together integration path.

import { describe, expect, it } from 'vitest';
import { SceneStore } from '../src/store.js';
import { drawGetPreview } from '../src/tools/drawGetPreview.js';
import type { PreviewBus, PreviewResponse } from '../src/preview-bus.js';

interface ImageBlock {
  type: 'image';
  data: string;
  mimeType: string;
}
interface TextBlock {
  type: 'text';
  text: string;
}

function isImageBlock(block: unknown): block is ImageBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'image'
  );
}
function isTextBlock(block: unknown): block is TextBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'text'
  );
}

interface StubBusHandle {
  bus: PreviewBus;
  emits: { requestId: string; format: 'png' | 'jpeg'; scale: number }[];
  resolve(response: PreviewResponse): void;
  reject(err: Error): void;
}

function makeStubBus(opts: {
  hasSubscribers?: boolean;
  /** If set, await responds immediately with this value. */
  immediate?: PreviewResponse;
  /** If set, await rejects immediately with this error. */
  immediateError?: Error;
} = {}): StubBusHandle {
  const emits: {
    requestId: string;
    format: 'png' | 'jpeg';
    scale: number;
  }[] = [];
  let deferredResolve: ((v: PreviewResponse) => void) | null = null;
  let deferredReject: ((err: Error) => void) | null = null;

  const bus: PreviewBus = {
    emitRequest(requestId, format, scale): void {
      emits.push({ requestId, format, scale });
    },
    awaitResponse(_requestId, _timeoutMs): Promise<PreviewResponse> {
      if (opts.immediateError !== undefined) {
        return Promise.reject(opts.immediateError);
      }
      if (opts.immediate !== undefined) {
        return Promise.resolve(opts.immediate);
      }
      return new Promise<PreviewResponse>((resolve, reject) => {
        deferredResolve = resolve;
        deferredReject = reject;
      });
    },
    hasSubscribers(): boolean {
      return opts.hasSubscribers ?? true;
    },
  };

  return {
    bus,
    emits,
    resolve(response): void {
      deferredResolve?.(response);
    },
    reject(err): void {
      deferredReject?.(err);
    },
  };
}

describe('draw_get_preview', () => {
  it('returns a headless-mode error when no preview bus is available', async () => {
    const store = new SceneStore();
    const result = await drawGetPreview.execute({}, store);
    expect(result.isError).toBe(true);
    const block = result.content[0];
    expect(isTextBlock(block)).toBe(true);
    if (isTextBlock(block)) {
      expect(block.text).toMatch(/headless/i);
    }
  });

  it('emits a request and returns the image payload when the app responds', async () => {
    const store = new SceneStore();
    const stub = makeStubBus({
      immediate: { data: 'AAAA', mimeType: 'image/png' },
    });

    const result = await drawGetPreview.execute(
      { format: 'png', scale: 2 },
      store,
      { previewBus: stub.bus },
    );
    expect(result.isError).toBeUndefined();
    expect(stub.emits).toHaveLength(1);
    expect(stub.emits[0]?.format).toBe('png');
    expect(stub.emits[0]?.scale).toBe(2);

    const block = result.content[0];
    expect(isImageBlock(block)).toBe(true);
    if (isImageBlock(block)) {
      expect(block.data).toBe('AAAA');
      expect(block.mimeType).toBe('image/png');
    }
  });

  it('surfaces a timeout from the bus as an isError result', async () => {
    const store = new SceneStore();
    const stub = makeStubBus({
      immediateError: new Error('awaitResponse timeout for req-1'),
    });

    const result = await drawGetPreview.execute(
      { timeoutMs: 1000 },
      store,
      { previewBus: stub.bus },
    );
    expect(result.isError).toBe(true);
    const block = result.content[0];
    expect(isTextBlock(block)).toBe(true);
    if (isTextBlock(block)) {
      expect(block.text).toMatch(/timed out/i);
    }
  });

  it('fast-fails when no subscribers are attached to the event stream', async () => {
    const store = new SceneStore();
    const stub = makeStubBus({ hasSubscribers: false });

    const result = await drawGetPreview.execute({}, store, {
      previewBus: stub.bus,
    });
    expect(result.isError).toBe(true);
    // Nothing should have been emitted — we short-circuited before that.
    expect(stub.emits).toHaveLength(0);
    const block = result.content[0];
    expect(isTextBlock(block)).toBe(true);
    if (isTextBlock(block)) {
      expect(block.text).toMatch(/no app is currently subscribed/i);
    }
  });
});
