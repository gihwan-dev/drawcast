//! Tauri app shell entrypoint for Drawcast.
//!
//! Wires:
//! - The MCP sidecar supervisor.
//! - Session management: create / list / switch.
//! - Clipboard + file export sinks for the canvas toolbar.
//! - The `chat_host` supervisor — long-running `claude -p` child that
//!   drives the Chat panel over stream-json NDJSON.
//!
//! The previous xterm/CLI-host and Codex-registration paths were removed
//! in favour of the chat pipeline. User auth is the `claude` CLI's own
//! OAuth session (Pro/Max subscription); Drawcast never handles API
//! keys.
mod chat_host;
mod clipboard;
mod files;
mod session;
mod sidecar;
mod uploads;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_updater::UpdaterExt;

use crate::chat_host::{ChatHost, ManagedChatHost};
use crate::session::SessionMeta;
use crate::sidecar::{get_sidecar_port, ManagedSidecar, McpSidecar};

/// Currently-active session. Shared across command handlers so the frontend
/// can read `get_current_session` without re-scanning disk.
pub type ManagedSession = std::sync::Mutex<Option<SessionMeta>>;

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_sidecar_port,
            get_default_session_path,
            chat_send,
            chat_cancel,
            chat_shutdown,
            check_claude_installed,
            create_session,
            list_sessions,
            switch_session,
            get_current_session,
            save_upload,
            save_preview_bytes,
            read_file_bytes,
            clipboard_write_png,
            clipboard_write_text,
            save_export_bytes,
            check_for_updates,
        ])
        .setup(|app| {
            // Bootstrap the default session directory + metadata, then spawn
            // the sidecar pointing at it. Named sessions the user created
            // before continue to live alongside `default`.
            let session_path = session::default_session_path()?;
            let meta = session::load_meta(&session_path).unwrap_or_else(|_| {
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
            app.manage::<ManagedChatHost>(tokio::sync::Mutex::new(None));
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

            // Tear down the chat child (if any) alongside.
            let chat_state: tauri::State<'_, ManagedChatHost> = app_handle.state();
            let _ = tauri::async_runtime::block_on(async move {
                let mut guard = chat_state.lock().await;
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

/// Persist a snapshot PNG inside the session's `previews/` directory.
/// Called by the TopBar 📸 button — separate from `save_upload` so the
/// two channels land under distinct subdirs and can't accidentally
/// collide with one another's filenames.
#[tauri::command]
async fn save_preview_bytes(
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
    let saved = uploads::save_preview_bytes(&path, &filename, &data)
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

/// Decode and put PNG bytes on the system clipboard. Frontend sends the raw
/// PNG bytes (produced by `exportToBlob`) and the Rust side converts to the
/// RGBA buffer arboard expects.
#[tauri::command]
async fn clipboard_write_png(data: Vec<u8>) -> Result<(), String> {
    clipboard::write_png(&data).map_err(|e| e.to_string())
}

/// Put plain text on the system clipboard. Used for the "Copy as Excalidraw"
/// path — Excalidraw web and the Obsidian plugin both detect the JSON
/// envelope on paste, so a single text flavor is enough for the MVP.
#[tauri::command]
async fn clipboard_write_text(text: String) -> Result<(), String> {
    clipboard::write_text(&text).map_err(|e| e.to_string())
}

/// Write a serialized scene envelope (`.excalidraw` JSON or
/// `.excalidraw.md` markdown) to a user-chosen path. The frontend already
/// picked the destination via Tauri's dialog plugin; this command is a
/// thin sink so we don't have to pull in the full fs plugin.
#[tauri::command]
async fn save_export_bytes(path: String, data: Vec<u8>) -> Result<String, String> {
    if path.is_empty() {
        return Err("export path must not be empty".to_string());
    }
    let target = PathBuf::from(&path);
    files::write_file(&target, &data).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

/// Send a user message to the chat. Lazily spawns the `claude` child on
/// first call (or after a cancel/shutdown). `content` is the `content`
/// array of an Anthropic user message — the Rust side wraps it into the
/// full stream-json envelope before writing to the child's stdin.
#[tauri::command]
async fn chat_send(
    app: tauri::AppHandle,
    content: serde_json::Value,
) -> Result<(), String> {
    if !content.is_array() {
        return Err("content must be a JSON array of Anthropic content blocks".to_string());
    }

    ensure_chat_running(&app).await?;

    let envelope = serde_json::json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": content,
        }
    });
    let line = serde_json::to_string(&envelope).map_err(|e| e.to_string())?;

    let state: tauri::State<'_, ManagedChatHost> = app.state();
    let guard = state.lock().await;
    let host = guard
        .as_ref()
        .ok_or_else(|| "chat host is not running".to_string())?;
    host.write_line(&line).await.map_err(|e| e.to_string())
}

/// Cancel the in-flight turn by killing the chat child. Next `chat_send`
/// will respawn. Note: this loses the claude-side session id — we don't
/// pass `--resume` yet, so a cancel currently resets conversation memory.
/// Multi-turn resume is a follow-up.
#[tauri::command]
async fn chat_cancel(app: tauri::AppHandle) -> Result<(), String> {
    let state: tauri::State<'_, ManagedChatHost> = app.state();
    let mut guard = state.lock().await;
    if let Some(host) = guard.take() {
        host.shutdown().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Graceful chat shutdown. Semantically identical to `chat_cancel` today
/// but kept separate so we can later diverge (e.g. persist session id on
/// shutdown without persisting on cancel).
#[tauri::command]
async fn chat_shutdown(app: tauri::AppHandle) -> Result<(), String> {
    let state: tauri::State<'_, ManagedChatHost> = app.state();
    let mut guard = state.lock().await;
    if let Some(host) = guard.take() {
        host.shutdown().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Onboarding probe — Welcome enables "Get started" iff this returns true.
/// Shares `chat_host::resolve_claude_binary` so detection and spawn agree.
#[tauri::command]
fn check_claude_installed() -> bool {
    chat_host::is_claude_installed()
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
fn get_current_session(
    state: tauri::State<'_, ManagedSession>,
) -> Result<Option<SessionMeta>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

/// Orchestrated session switch:
///   1. Shut down the current chat child (keeps conversation isolated per
///      session).
///   2. Shut down the current MCP sidecar.
///   3. Respawn the sidecar pointing at the new session dir.
///   4. Update the managed `current session` slot.
///   5. Emit `session-switched { meta }` so the frontend can reset state.
///
/// The sidecar negotiates a fresh port on respawn; the existing
/// `sidecar-port` + `sidecar-ready` event flow on the frontend picks up
/// the new port. The next chat message lazily respawns the `claude`
/// child against the new cwd + port.
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

    // 1. Shut down any running chat child so it doesn't keep a stale cwd
    //    or blend conversations across sessions.
    {
        let chat_state: tauri::State<'_, ManagedChatHost> = app.state();
        let mut guard = chat_state.lock().await;
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

    // 5. Let the frontend know so it can clear sceneStore + chat history.
    let _ = app.emit("session-switched", &meta);

    Ok(meta)
}

/// Lazy chat spawner. Called from `chat_send` on first use, or after the
/// previous child exited. Pulls the current session path + sidecar port
/// from managed state so the child inherits both without the frontend
/// having to orchestrate.
async fn ensure_chat_running(app: &tauri::AppHandle) -> Result<(), String> {
    // Reuse an existing host only if its child is still alive; otherwise
    // drop the dead handle so the spawn path below kicks in.
    {
        let state: tauri::State<'_, ManagedChatHost> = app.state();
        let mut guard = state.lock().await;
        if let Some(existing) = guard.as_ref() {
            if existing.is_alive().await {
                return Ok(());
            }
        }
        *guard = None;
    }

    let session_path: PathBuf = {
        let state: tauri::State<'_, ManagedSession> = app.state();
        let guard = state.lock().map_err(|e| e.to_string())?;
        let meta = guard
            .as_ref()
            .ok_or_else(|| "no active session".to_string())?;
        session::session_path_for(&meta.id).map_err(|e| e.to_string())?
    };
    if !session_path.is_dir() {
        return Err(format!(
            "session path does not exist: {}",
            session_path.display()
        ));
    }

    let sidecar_port: Option<u16> = {
        let state: tauri::State<'_, ManagedSidecar> = app.state();
        let opt = {
            let guard = state.lock().map_err(|e| e.to_string())?;
            guard.clone()
        };
        match opt {
            Some(s) => s.port().await,
            None => None,
        }
    };

    let host = ChatHost::spawn(app, session_path, sidecar_port).map_err(|e| e.to_string())?;
    {
        let state: tauri::State<'_, ManagedChatHost> = app.state();
        let mut guard = state.lock().await;
        *guard = Some(host);
    }
    Ok(())
}

/// Shape returned to the frontend's `checkForUpdates()` wrapper.
/// `hasUpdate` is true iff the updater plugin resolved an entry whose
/// semver is newer than `tauri.conf.json` → `version`. When true, the
/// optional `version` field carries the remote's version string so the
/// UI can render a banner like "Drawcast 0.2.0 available".
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    has_update: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
}

/// Check for a pending update via the `tauri-plugin-updater`. Does NOT
/// download — the frontend calls `downloadAndInstall()` separately so
/// the user can see a confirmation UI first. Errors surface as plain
/// strings so the JS side can toast them.
#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<UpdateStatus, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateStatus {
            has_update: true,
            version: Some(update.version.clone()),
        }),
        Ok(None) => Ok(UpdateStatus {
            has_update: false,
            version: None,
        }),
        Err(err) => Err(err.to_string()),
    }
}
