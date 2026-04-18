// Thin wrapper over `@tauri-apps/plugin-updater` so the UI layer doesn't have
// to import Tauri plugin types directly. PR #21 (Phase 6.2) wires this to a
// toolbar/menu button plus the auto-check on startup.
//
// The endpoint + pubkey that gate these calls live in
// `packages/app/src-tauri/tauri.conf.json` under `plugins.updater` — see
// `packages/app/RELEASE.md` for the key-generation and tag-to-release flow.
import { check, type Update } from '@tauri-apps/plugin-updater';

export interface UpdateCheckResult {
  hasUpdate: boolean;
  version?: string;
}

/**
 * Hit the configured updater endpoint (`latest.json` on GitHub Releases) and
 * return whether a newer build is available. Does NOT download — the caller
 * is expected to prompt the user before handing off to `downloadAndInstall`.
 *
 * Returns `{ hasUpdate: false }` when the endpoint is reachable but reports
 * no update; throws the original error string when the request itself fails
 * (no network, malformed manifest, signature mismatch) so the UI can toast
 * it verbatim.
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const update = await check();
  if (!update) return { hasUpdate: false };
  // Hold onto the handle only long enough to read the version — the Update
  // resource is reclaimed when we return. Anything needing the handle
  // afterwards (e.g. `downloadAndInstall`) re-runs `check()`.
  const version = update.version;
  pendingUpdate = update;
  return { hasUpdate: true, version };
}

/**
 * Apply the update pulled by the most recent `checkForUpdates()` call. On
 * success the app restarts automatically (the plugin drives that).
 *
 * If the caller never ran `checkForUpdates()` (or `null` came back), this
 * re-runs `check()` and short-circuits with "no update available".
 */
export async function downloadAndInstall(): Promise<void> {
  const update = pendingUpdate ?? (await check());
  if (!update) throw new Error('no update available');
  try {
    await update.downloadAndInstall();
  } finally {
    pendingUpdate = null;
  }
}

// Caching the most recent `check()` response avoids re-hitting the network
// when the UI flow is "banner appears → user clicks Install". The plugin's
// `Update` resource is effectively a ticket for one install attempt, so we
// clear the slot after a download succeeds/fails.
let pendingUpdate: Update | null = null;
