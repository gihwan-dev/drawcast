// Thin wrapper over the Tauri event bus so React components don't have to
// care about event-name strings. The Rust supervisor (src-tauri/src/sidecar.rs)
// is the producer.
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export interface SidecarLogPayload {
  level: 'stdout' | 'stderr' | 'error';
  line: string;
}

export interface SidecarExitPayload {
  code: number | null;
}

export interface SubscribeOptions {
  onPort?: (port: number) => void;
  onReady?: (port: number) => void;
  onLog?: (payload: SidecarLogPayload) => void;
  onExit?: (code: number | null) => void;
}

/**
 * Subscribe to sidecar lifecycle events. Returns a disposer that unlistens
 * to every subscription in one call.
 */
export function subscribeSidecar(opts: SubscribeOptions): () => void {
  const pending: Array<Promise<UnlistenFn>> = [];

  if (opts.onPort) {
    pending.push(
      listen<{ port: number }>('sidecar-port', (ev) => {
        opts.onPort?.(ev.payload.port);
      }),
    );
  }
  if (opts.onReady) {
    pending.push(
      listen<{ port: number }>('sidecar-ready', (ev) => {
        opts.onReady?.(ev.payload.port);
      }),
    );
  }
  if (opts.onLog) {
    pending.push(
      listen<SidecarLogPayload>('sidecar-log', (ev) => {
        opts.onLog?.(ev.payload);
      }),
    );
  }
  if (opts.onExit) {
    pending.push(
      listen<SidecarExitPayload>('sidecar-exit', (ev) => {
        opts.onExit?.(ev.payload.code);
      }),
    );
  }

  let disposed = false;
  const unlistens: UnlistenFn[] = [];
  void (async () => {
    for (const promise of pending) {
      try {
        const fn = await promise;
        if (disposed) {
          fn();
        } else {
          unlistens.push(fn);
        }
      } catch {
        // Non-Tauri contexts (Vitest / storybook) just resolve nothing.
      }
    }
  })();

  return () => {
    disposed = true;
    for (const fn of unlistens.splice(0)) {
      fn();
    }
  };
}

/**
 * Poll the current sidecar port from Rust. Useful when a component mounts
 * after `sidecar-ready` has already fired.
 */
export async function getSidecarPort(): Promise<number | null> {
  try {
    const port = await invoke<number | null>('get_sidecar_port');
    return port ?? null;
  } catch {
    return null;
  }
}
