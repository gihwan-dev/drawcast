//! Tauri app shell entrypoint for Drawcast (PR #12).
//!
//! Wires the MCP sidecar supervisor, exposes commands that the frontend uses
//! to poll sidecar state, and cleans up on window close.
mod session;
mod sidecar;

use std::sync::Mutex;

use tauri::{Manager, RunEvent, WindowEvent};

use crate::sidecar::{get_sidecar_port, ManagedSidecar, McpSidecar};

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![get_sidecar_port])
        .setup(|app| {
            let session_path = session::default_session_path()?;
            let sidecar = McpSidecar::spawn(&app.handle(), session_path)?;
            app.manage::<ManagedSidecar>(Mutex::new(Some(sidecar)));
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
        }
    });
}
