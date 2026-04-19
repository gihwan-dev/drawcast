// Unit tests for `requestScenePreview` — the shared helper that drives the
// `PreviewBus` round-trip for both `draw_get_preview` and the upsert
// tools' `returnPreview` option. We exercise the four branches directly
// against stub buses so we can assert on the structured result object
// without booting a transport.

import { describe, expect, it } from 'vitest';
import type { PreviewBus, PreviewResponse } from '../src/preview-bus.js';
import { requestScenePreview } from '../src/tools/helpers/preview.js';

interface StubBusOpts {
  hasSubscribers?: boolean;
  immediate?: PreviewResponse;
  immediateError?: Error;
}

function makeBus(opts: StubBusOpts = {}): {
  bus: PreviewBus;
  emits: { requestId: string; format: 'png' | 'jpeg'; scale: number }[];
} {
  const emits: {
    requestId: string;
    format: 'png' | 'jpeg';
    scale: number;
  }[] = [];
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
      // Never-resolves — tests that hit this path should set
      // `immediate` or `immediateError` explicitly.
      return new Promise<PreviewResponse>(() => {});
    },
    hasSubscribers(): boolean {
      return opts.hasSubscribers ?? true;
    },
  };
  return { bus, emits };
}

describe('requestScenePreview', () => {
  it('returns a headless warning when no preview bus is injected', async () => {
    const result = await requestScenePreview(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.warning).toMatch(/headless/i);
    }
  });

  it('returns a no-subscribers warning when nobody is listening on /events', async () => {
    const { bus, emits } = makeBus({ hasSubscribers: false });
    const result = await requestScenePreview(bus);
    expect(result.ok).toBe(false);
    // The helper must short-circuit BEFORE emitting a request — otherwise
    // the model waits out the timeout for nothing.
    expect(emits).toHaveLength(0);
    if (!result.ok) {
      expect(result.warning).toMatch(/no app is currently subscribed/i);
    }
  });

  it('surfaces a rejected awaitResponse as a timeout-shaped warning', async () => {
    const { bus } = makeBus({
      immediateError: new Error('awaitResponse timeout for req-1'),
    });
    const result = await requestScenePreview(bus, { timeoutMs: 1500 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.warning).toMatch(/timed out/i);
      expect(result.warning).toContain('1500ms');
    }
  });

  it('returns an image block when the bus resolves successfully', async () => {
    const { bus, emits } = makeBus({
      immediate: { data: 'AAAA', mimeType: 'image/png' },
    });
    const result = await requestScenePreview(bus, {
      format: 'jpeg',
      scale: 3,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.image).toEqual({
        type: 'image',
        data: 'AAAA',
        mimeType: 'image/png',
      });
    }
    expect(emits).toHaveLength(1);
    expect(emits[0]?.format).toBe('jpeg');
    expect(emits[0]?.scale).toBe(3);
  });

  it('treats an empty data payload as a soft skip, not an image', async () => {
    const { bus } = makeBus({
      immediate: { data: '', mimeType: 'image/png' },
    });
    const result = await requestScenePreview(bus);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.warning).toMatch(/empty image/i);
    }
  });
});
