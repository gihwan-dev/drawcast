//! Session directory resolution (PR #12 stub).
//!
//! Full session management (new / switch / list) lands in PR #15. This module
//! only implements the bare minimum needed to boot the sidecar with a valid
//! `--session-path`.
use std::path::PathBuf;

use anyhow::{anyhow, Context, Result};

/// `$HOME/.drawcast/sessions/default`. Created if missing.
///
/// Mirrors `defaultSessionPath()` in `packages/mcp-server/src/cli.ts` so both
/// sides of the IPC agree on the directory layout.
pub fn default_session_path() -> Result<PathBuf> {
    let home = dirs_home()?;
    let path = home.join(".drawcast").join("sessions").join("default");
    std::fs::create_dir_all(&path)
        .with_context(|| format!("failed to create session dir: {}", path.display()))?;
    Ok(path)
}

fn dirs_home() -> Result<PathBuf> {
    // Tauri 2 targets don't expose `std::env::home_dir` (deprecated), and we
    // don't want to pull in the full `dirs` crate for one lookup. Read the
    // canonical env var directly — Windows falls back to USERPROFILE.
    if let Some(h) = std::env::var_os("HOME") {
        return Ok(PathBuf::from(h));
    }
    if let Some(h) = std::env::var_os("USERPROFILE") {
        return Ok(PathBuf::from(h));
    }
    Err(anyhow!("unable to resolve home directory: HOME/USERPROFILE unset"))
}
