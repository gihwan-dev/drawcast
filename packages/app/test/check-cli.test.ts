// Thin test for the `checkCliInstalled` wrapper. The real command lives
// in `packages/app/src-tauri/src/lib.rs` and delegates to
// `cli_host::resolve_binary`; the JS side just needs to call `invoke`
// with the right command name + payload so the two stay in lock-step.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { checkCliInstalled } from '../src/services/cli.js';

// The module-level mock from test/setup.ts makes `invoke` resolve to null;
// override per-test to exercise success/error paths.
describe('checkCliInstalled', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('invokes the check_cli_installed Tauri command with the CLI kind', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true as unknown as null);
    const ok = await checkCliInstalled('claude-code');
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('check_cli_installed', {
      which: 'claude-code',
    });
  });

  it('returns false when the IPC bridge throws (non-Tauri host)', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('no Tauri'));
    const ok = await checkCliInstalled('codex');
    expect(ok).toBe(false);
  });
});
