# Releasing Drawcast

This doc covers cutting a signed, auto-updating Drawcast release. Phase 6.1 +
6.2 of [`docs/10-development-roadmap.md`](../../docs/10-development-roadmap.md)
brings the matrix CI + Tauri updater online; what follows is the operational
flow on top of that infrastructure.

## 1. One-time: generate the updater signing keypair

Tauri signs every bundle with an Ed25519 key that the updater plugin verifies
against the embedded `pubkey` at runtime. The key only has to be generated
once per app identity — rotating it means every installed client stops
accepting updates until it re-installs manually, so keep it somewhere safe.

```sh
pnpm --filter @drawcast/app exec tauri signer generate \
  --write-keys ~/.tauri/drawcast.key
```

Artifacts:

- `~/.tauri/drawcast.key` — private key, keep this out of git
- `~/.tauri/drawcast.key.pub` — public key, embed it in the app

Paste the public key into
[`src-tauri/tauri.conf.json`](./src-tauri/tauri.conf.json) at
`plugins.updater.pubkey`, replacing `<FILL IN PUBLIC KEY AT RELEASE TIME>`.

Paste the private key contents into the GitHub repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY` — the full contents of the `.key` file
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the passphrase entered above

`.github/workflows/release.yml` reads both values from `secrets` and passes
them to `tauri build` as env vars, which is how the Tauri CLI locates them.

## 2. Point the updater endpoint at your repo

Once above, open `src-tauri/tauri.conf.json` and replace
`<OWNER>` in
`https://github.com/<OWNER>/drawcast/releases/latest/download/latest.json`
with the actual GitHub org/user. This URL needs to match where
`release.yml` uploads the bundles — by default that's whatever repo the
workflow runs in.

## 3. Cut a release

```sh
# from `main`, with a clean tree
git tag v0.1.0
git push origin v0.1.0
```

Pushing the tag triggers `.github/workflows/release.yml`:

1. `bundle` matrix runs on four runners (macOS arm64, macOS x64, Ubuntu,
   Windows). Each leg:
   - installs pnpm + bun + the Rust triple
   - builds the TypeScript `@drawcast/mcp-server`
   - cross-compiles the sidecar via
     `scripts/build-sidecar.mjs --target <triple>`
   - bundles the Tauri app, signed with `TAURI_SIGNING_PRIVATE_KEY`
   - uploads the platform-specific artifacts
2. `release` job runs only when the trigger was a `v*` tag. It downloads
   every matrix artifact and publishes a GitHub Release via
   `softprops/action-gh-release@v2`, with auto-generated release notes.

Expected artifacts per triple:

| triple                          | files                                 |
| ------------------------------- | ------------------------------------- |
| `aarch64-apple-darwin`          | `Drawcast_<version>_aarch64.dmg`, `.app.tar.gz`, `.app.tar.gz.sig` |
| `x86_64-apple-darwin`           | `Drawcast_<version>_x64.dmg`, `.app.tar.gz`, `.app.tar.gz.sig`     |
| `x86_64-unknown-linux-gnu`      | `drawcast_<version>_amd64.AppImage`, `.AppImage.sig`               |
| `x86_64-pc-windows-msvc`        | `Drawcast_<version>_x64_en-US.msi`, `.msi.sig`                     |

## 4. Author `latest.json`

Tauri's updater checks a JSON manifest. The release workflow does NOT
generate this manifest yet — it's a follow-up (Phase 6.3 code signing +
notarization land first, since the manifest needs the macOS
`.app.tar.gz` built against a notarized binary).

Template (upload alongside the bundles):

```json
{
  "version": "0.1.0",
  "notes": "see https://github.com/<OWNER>/drawcast/releases/tag/v0.1.0",
  "pub_date": "2026-04-18T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<contents of .app.tar.gz.sig>",
      "url": "https://github.com/<OWNER>/drawcast/releases/download/v0.1.0/Drawcast_0.1.0_aarch64.app.tar.gz"
    },
    "darwin-x86_64": { "signature": "...", "url": "..." },
    "linux-x86_64":  { "signature": "...", "url": "..." },
    "windows-x86_64":{ "signature": "...", "url": "..." }
  }
}
```

## 5. Verifying locally (before your first tagged release)

Because workflow behavior can't be exercised end-to-end on a dev laptop,
validate the matrix in a fork first:

1. Fork the repo.
2. Add the two `TAURI_SIGNING_*` secrets to the fork.
3. Push a throwaway tag: `git tag v0.0.1-test && git push origin v0.0.1-test`.
4. Check the Actions tab — all four legs should go green.
5. Delete the fork or the test tag when done.

## 6. Updater runtime flow

Client-side wiring lives in
[`src/services/update.ts`](./src/services/update.ts):

- `checkForUpdates()` hits the `endpoints[]` from `tauri.conf.json` and
  returns `{ hasUpdate, version? }`.
- `downloadAndInstall()` applies the pending update and triggers a
  restart when the plugin reports success.

The Rust side registers `tauri-plugin-updater` in
[`src-tauri/src/lib.rs`](./src-tauri/src/lib.rs) and also exposes a
`check_for_updates` Tauri command for the equivalent Rust-driven check.

## 7. Known follow-ups

- **Code signing (Phase 6.3)** — Apple Developer ID + notarization, plus
  Windows EV signing, both of which will change the bundle hashes and
  therefore require regenerating `latest.json`.
- **Clippy `-D warnings`** — the existing codebase has a handful of
  non-blocking clippy suggestions. Once those are cleaned up, re-enable
  `-D warnings` in `.github/workflows/ci.yml`.
- **`latest.json` generation** — should be done in-workflow once signing
  is in place; for now it's a manual post-step.
