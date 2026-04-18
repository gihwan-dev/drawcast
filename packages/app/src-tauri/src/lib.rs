//! Tauri app shell entrypoint for Drawcast.
//!
//! Wires:
//! - The MCP sidecar supervisor (PR #12).
//! - The CLI host + auto-registration for Claude Code / Codex (PR #14).
//! - Session management: create / list / switch (PR #15).
//!
//! Exposes Tauri commands that the frontend uses to spawn and interact with
//! those subprocesses.
mod cli_host;
mod cli_register;
mod session;
mod sidecar;
mod uploads;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Emitter, Manager, RunEvent, WindowEvent};

use crate::cli_host::{CliHost, CliKind, ManagedCliHost};
use crate::cli_register::{
    register_claude, register_codex, RegistrationStatus,
};
use crate::session::SessionMeta;
use crate::sidecar::{get_sidecar_port, ManagedSidecar, McpSidecar};

/// Currently-active session. Shared across command handlers so the frontend
/// can read `get_current_session` without re-scanning disk.
pub type ManagedSession = std::sync::Mutex<Option<SessionMeta>>;

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_sidecar_port,
            get_default_session_path,
            spawn_cli,
            cli_stdin,
            cli_resize,
            cli_shutdown,
            register_cli,
            create_session,
            list_sessions,
            switch_session,
            get_current_session,
            save_upload,
            read_file_bytes,
        ])
        .setup(|app| {
            // Bootstrap the default session directory + metadata, then spawn
            // the sidecar pointing at it. If the user previously created
            // named sessions those continue to live alongside `default`.
            let session_path = session::default_session_path()?;
            let meta = session::load_meta(&session_path)
                .unwrap_or_else(|_| {
                    // default_session_path() guarantees meta exists, but if
                    // the file was corrupted we fall back to a synthetic stub
                    // rather than crashing at boot.
                    SessionMeta {
                        id: "default".to_string(),
                        name: "Default".to_string(),
                        created_at: 0,
                        updated_at: 0,
                        cli_choice: None,
                        theme: "sketchy".to_string(),
                        last_known_port: None,
                    }
                });
            let sidecar = McpSidecar::spawn(&app.handle(), session_path)?;
            app.manage::<ManagedSidecar>(Mutex::new(Some(sidecar)));
            app.manage::<ManagedCliHost>(tokio::sync::Mutex::new(None));
            app.manage::<ManagedSession>(Mutex::new(Some(meta)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::WindowEvent {
            event: WindowEvent::CloseRequested { .. },
            ..
        } = &event
        {
            // Drain the managed sidecar and shut it down before the window
            // closes. This is synchronous from the caller's perspective — we
            // block on the async shutdown via the tauri async runtime so the
            // 10s timeout has time to fire before the process exits.
            let state: tauri::State<'_, ManagedSidecar> = app_handle.state();
            let sidecar_opt = {
                match state.lock() {
                    Ok(mut guard) => guard.take(),
                    Err(_) => None,
                }
            };
            if let Some(sidecar) = sidecar_opt {
                let _ = tauri::async_runtime::block_on(async move { sidecar.shutdown().await });
            }

            // Tear down any running CLI host as well.
            let cli_state: tauri::State<'_, ManagedCliHost> = app_handle.state();
            let _ = tauri::async_runtime::block_on(async move {
                let mut guard = cli_state.lock().await;
                if let Some(host) = guard.take() {
                    let _ = host.shutdown().await;
                }
            });
        }
    });
}

#[tauri::command]
fn get_default_session_path() -> Result<String, String> {
    let path = session::default_session_path().map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Persist an uploaded file inside the session's `uploads/` directory. Called
/// by all three upload channels (drag-drop, clipboard paste, file picker).
/// Returns the absolute path the bytes landed at, so the frontend can surface
/// the actual name after sanitization/collision-suffixing.
#[tauri::command]
async fn save_upload(
    session_path: String,
    filename: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let path = PathBuf::from(&session_path);
    if !path.is_dir() {
        return Err(format!(
            "session path does not exist: {}",
            path.display()
        ));
    }
    let saved = uploads::save_upload(&path, &filename, &data)
        .map_err(|e| e.to_string())?;
    Ok(saved.to_string_lossy().to_string())
}

/// Small wrapper for the paperclip file-picker flow: Tauri's dialog plugin
/// returns paths, we read those bytes here so we can then funnel through
/// `save_upload`. A dedicated command is lighter than pulling in the full
/// `tauri-plugin-fs` surface just for one-off reads.
#[tauri::command]
async fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(&path);
    if !path.is_file() {
        return Err(format!("not a file: {}", path.display()));
    }
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn spawn_cli(
    app: tauri::AppHandle,
    which: String,
    session_path: String,
) -> Result<(), String> {
    let kind = CliKind::from_str(&which).map_err(|e| e.to_string())?;
    let path = PathBuf::from(&session_path);
    if !path.is_dir() {
        return Err(format!(
            "session path does not exist: {}",
            path.display()
        ));
    }

    // Tear down any existing host first so we don't leak processes.
    let state: tauri::State<'_, ManagedCliHost> = app.state();
    {
        let mut guard = state.lock().await;
        if let Some(existing) = guard.take() {
            let _ = existing.shutdown().await;
        }
    }

    let host = CliHost::spawn(&app, kind, path).map_err(|e| e.to_string())?;
    {
        let mut guard = state.lock().await;
        *guard = Some(host);
    }
    Ok(())
}

#[tauri::command]
async fn cli_stdin(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let state: tauri::State<'_, ManagedCliHost> = app.state();
    let guard = state.lock().await;
    let host = guard
        .as_ref()
        .ok_or_else(|| "no CLI is running".to_string())?;
    host.write_stdin(&data).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn cli_resize(
    app: tauri::AppHandle,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let state: tauri::State<'_, ManagedCliHost> = app.state();
    let guard = state.lock().await;
    let host = guard
        .as_ref()
        .ok_or_else(|| "no CLI is running".to_string())?;
    host.resize(cols, rows).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn cli_shutdown(app: tauri::AppHandle) -> Result<(), String> {
    let state: tauri::State<'_, ManagedCliHost> = app.state();
    let mut guard = state.lock().await;
    if let Some(host) = guard.take() {
        host.shutdown().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn register_cli(app: tauri::AppHandle, which: String) -> Result<String, String> {
    let sidecar_bin = resolve_sidecar_path(&app).map_err(|e| e.to_string())?;
    let status: RegistrationStatus = match which.as_str() {
        "claude-code" | "claude" => register_claude(&sidecar_bin)
            .await
            .map_err(|e| e.to_string())?,
        "codex" => register_codex(&sidecar_bin)
            .await
            .map_err(|e| e.to_string())?,
        other => return Err(format!("unknown CLI kind: {other}")),
    };
    Ok(status.as_str().to_string())
}

#[tauri::command]
fn create_session(name: String) -> Result<SessionMeta, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("session name must not be empty".to_string());
    }
    session::create_session(trimmed).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_sessions() -> Result<Vec<SessionMeta>, String> {
    session::list_sessions().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_current_session(state: tauri::State<'_, ManagedSession>) -> Result<Option<SessionMeta>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

/// Orchestrated session switch:
///   1. Stop any running CLI host.
///   2. Shut down the current sidecar.
///   3. Respawn the sidecar pointing at the new session dir.
///   4. Update the managed `current session` slot.
///   5. Emit `session-switched { meta }` so the frontend can reset state.
///
/// The sidecar negotiates a fresh port on respawn; the existing `sidecar-port`
/// + `sidecar-ready` event flow on the frontend picks up the new port and
/// reconnects the MCP SSE client automatically.
#[tauri::command]
async fn switch_session(app: tauri::AppHandle, id: String) -> Result<SessionMeta, String> {
    let new_path = session::session_path_for(&id).map_err(|e| e.to_string())?;
    if !new_path.is_dir() {
        return Err(format!(
            "session does not exist: {}",
            new_path.display()
        ));
    }
    let meta = session::load_meta(&new_path).map_err(|e| e.to_string())?;

    // 1. Shut down any running CLI host so it doesn't keep a stale cwd.
    {
        let cli_state: tauri::State<'_, ManagedCliHost> = app.state();
        let mut guard = cli_state.lock().await;
        if let Some(host) = guard.take() {
            let _ = host.shutdown().await;
        }
    }

    // 2. Stop the current sidecar.
    let old_sidecar = {
        let state: tauri::State<'_, ManagedSidecar> = app.state();
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.take()
    };
    if let Some(sidecar) = old_sidecar {
        if let Err(err) = sidecar.shutdown().await {
            // Non-fatal — the supervisor is torn down, we still respawn. Log
            // via the sidecar-log channel so the frontend's dev console sees it.
            let _ = app.emit(
                "sidecar-log",
                serde_json::json!({
                    "level": "error",
                    "line": format!("switch_session: old sidecar shutdown failed: {err}")
                }),
            );
        }
    }

    // 3. Respawn the sidecar at the new path.
    let new_sidecar =
        McpSidecar::spawn(&app, new_path.clone()).map_err(|e| e.to_string())?;
    {
        let state: tauri::State<'_, ManagedSidecar> = app.state();
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        *guard = Some(new_sidecar);
    }

    // 4. Update the managed current-session slot.
    {
        let state: tauri::State<'_, ManagedSession> = app.state();
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        *guard = Some(meta.clone());
    }

    // 5. Let the frontend know so it can clear sceneStore, etc.
    let _ = app.emit("session-switched", &meta);

    Ok(meta)
}

/// Resolve the drawcast-mcp sidecar path. Tauri bundles the sidecar next to
/// the app binary with a target triple suffix (e.g. `drawcast-mcp-aarch64-
/// apple-darwin`). We first check that file, then the generic name.
fn resolve_sidecar_path(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
    use anyhow::{anyhow, Context};
    let exe = app
        .path()
        .resource_dir()
        .or_else(|_| std::env::current_exe().map(|p| p.parent().map(|p| p.to_path_buf()).unwrap_or_default()))
        .context("resolve resource dir")?;

    // Candidate 1: resource-dir / drawcast-mcp-<target-triple>.
    // Candidate 2: resource-dir / drawcast-mcp (generic dev name).
    let triple = target_triple();
    let with_triple = exe.join(format!("drawcast-mcp-{triple}"));
    if with_triple.is_file() {
        return Ok(with_triple);
    }
    let plain = exe.join("drawcast-mcp");
    if plain.is_file() {
        return Ok(plain);
    }

    // Development fallback: assume drawcast-mcp is on PATH (the user installed
    // it globally via `pnpm --filter @drawcast/mcp-server install -g`, or the
    // dev scripts prepared it).
    if let Some(on_path) = which_in_path("drawcast-mcp") {
        return Ok(on_path);
    }

    Err(anyhow!(
        "could not locate drawcast-mcp sidecar (checked {}, {}, and PATH)",
        with_triple.display(),
        plain.display()
    ))
}

fn which_in_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn target_triple() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "aarch64-apple-darwin"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "x86_64-apple-darwin"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "x86_64-unknown-linux-gnu"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "aarch64-unknown-linux-gnu"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "x86_64-pc-windows-msvc"
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
        all(target_os = "windows", target_arch = "x86_64"),
    )))]
    {
        "unknown"
    }
}
