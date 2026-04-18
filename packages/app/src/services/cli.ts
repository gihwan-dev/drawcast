// Thin wrapper over Tauri invoke/listen for the CLI host backend. Keeps
// the panel code unaware of the underlying IPC surface — tests can mock
// this file directly.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type CliChoice = 'claude-code' | 'codex';
export type CliStream = 'stdout' | 'stderr';
export type RegistrationStatus = 'added' | 'updated' | 'already-present';

export interface CliOutputEvent {
  stream: CliStream;
  data: string;
}

export async function spawnCli(
  which: CliChoice,
  sessionPath: string,
): Promise<void> {
  await invoke('spawn_cli', { which, sessionPath });
}

export async function sendStdin(data: string): Promise<void> {
  await invoke('cli_stdin', { data });
}

export async function resizeCli(cols: number, rows: number): Promise<void> {
  await invoke('cli_resize', { cols, rows });
}

export async function shutdownCli(): Promise<void> {
  await invoke('cli_shutdown');
}

export async function registerCli(
  which: CliChoice,
): Promise<RegistrationStatus> {
  return (await invoke<string>('register_cli', { which })) as RegistrationStatus;
}

export async function getDefaultSessionPath(): Promise<string | null> {
  try {
    return await invoke<string>('get_default_session_path');
  } catch {
    return null;
  }
}

/**
 * Subscribe to raw CLI output chunks. The callback is fired per stdout/stderr
 * chunk exactly as emitted by the Rust side. Returns a disposer.
 */
export function subscribeCliOutput(
  cb: (ev: CliOutputEvent) => void,
): () => void {
  let disposed = false;
  let unlisten: UnlistenFn | null = null;
  void (async () => {
    try {
      const fn = await listen<CliOutputEvent>('cli-output', (ev) => {
        cb(ev.payload);
      });
      if (disposed) fn();
      else unlisten = fn;
    } catch {
      // In non-Tauri contexts (tests / storybook) the listen call never
      // resolves in a useful way — the mock in test/setup.ts short-circuits.
    }
  })();
  return () => {
    disposed = true;
    if (unlisten !== null) {
      unlisten();
      unlisten = null;
    }
  };
}

/**
 * Subscribe to the CLI exit event. Fires once per spawn.
 */
export function subscribeCliExit(cb: (code: number | null) => void): () => void {
  let disposed = false;
  let unlisten: UnlistenFn | null = null;
  void (async () => {
    try {
      const fn = await listen<{ code: number | null }>('cli-exit', (ev) => {
        cb(ev.payload.code);
      });
      if (disposed) fn();
      else unlisten = fn;
    } catch {
      // see subscribeCliOutput
    }
  })();
  return () => {
    disposed = true;
    if (unlisten !== null) {
      unlisten();
      unlisten = null;
    }
  };
}
