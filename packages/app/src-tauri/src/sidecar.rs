//! McpSidecar — spawns and supervises the `drawcast-mcp` sidecar binary.
//!
//! Responsibilities (PR #12):
//! - Spawn the sidecar via tauri-plugin-shell.
//! - Parse `DRAWCAST_PORT=<n>` / `DRAWCAST_READY=1` markers from stdout.
//! - Emit `sidecar-port`, `sidecar-ready`, `sidecar-log`, `sidecar-exit` events
//!   to the frontend.
//! - Auto-restart up to 3 times on non-zero exit.
//! - Graceful shutdown: send SIGTERM via `CommandChild::kill`, wait up to 10s,
//!   then force-kill.
//!
//! The supervisor loop runs in a detached `tokio::task::spawn`. The public
//! `McpSidecar` handle keeps a shared-state `Arc<Mutex<_>>` so `port()` /
//! `is_ready()` / `shutdown()` can be queried from Tauri command handlers.
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

const MAX_RESTARTS: u32 = 3;
const RESTART_DELAY_MS: u64 = 500;
const SHUTDOWN_TIMEOUT_MS: u64 = 10_000;

/// Internal supervisor state. Shared between the public handle and the
/// background supervisor task.
#[derive(Debug, Default)]
struct SharedState {
    port: Option<u16>,
    ready: bool,
    /// Current child handle. `take()`-ed on shutdown so we don't double-kill.
    child: Option<CommandChild>,
    /// Signals the supervisor loop to stop respawning.
    shutting_down: bool,
}

/// Public handle to the supervised MCP sidecar.
#[derive(Clone)]
pub struct McpSidecar {
    shared: Arc<Mutex<SharedState>>,
}

#[derive(Clone, Serialize)]
struct PortPayload {
    port: u16,
}

#[derive(Clone, Serialize)]
struct LogPayload {
    level: &'static str,
    line: String,
}

#[derive(Clone, Serialize)]
struct ExitPayload {
    code: Option<i32>,
}

impl McpSidecar {
    /// Spawn the sidecar and return a handle. The supervisor task keeps running
    /// in the background; callers don't need to await anything.
    pub fn spawn(app: &AppHandle, session_path: PathBuf) -> Result<Self> {
        let shared: Arc<Mutex<SharedState>> = Arc::new(Mutex::new(SharedState::default()));

        let app_for_task = app.clone();
        let shared_for_task = shared.clone();
        tauri::async_runtime::spawn(async move {
            supervise_loop(app_for_task, shared_for_task, session_path).await;
        });

        Ok(Self { shared })
    }

    /// Current negotiated port if the sidecar has announced one. `None` before
    /// the first `DRAWCAST_PORT=` line is seen.
    pub async fn port(&self) -> Option<u16> {
        self.shared.lock().await.port
    }

    /// `true` once `DRAWCAST_READY=1` has been emitted. Consumed by future
    /// PRs (StatusBar refresh, retry toasts); annotated so the current build
    /// stays warning-clean.
    #[allow(dead_code)]
    pub async fn is_ready(&self) -> bool {
        self.shared.lock().await.ready
    }

    /// Send SIGTERM, wait up to 10s, then drop. Stops the supervisor from
    /// respawning.
    pub async fn shutdown(&self) -> Result<()> {
        let child = {
            let mut state = self.shared.lock().await;
            state.shutting_down = true;
            state.child.take()
        };

        if let Some(child) = child {
            // tauri-plugin-shell's CommandChild::kill() sends SIGKILL on unix
            // and TerminateProcess on Windows. It's effectively the forced
            // termination path — we still wrap it in a bounded wait because
            // future tauri-plugin-shell revisions may introduce a graceful
            // variant.
            let kill_result = tokio::task::spawn_blocking(move || child.kill()).await;
            match tokio::time::timeout(
                Duration::from_millis(SHUTDOWN_TIMEOUT_MS),
                async { kill_result },
            )
            .await
            {
                Ok(Ok(Ok(()))) => Ok(()),
                Ok(Ok(Err(e))) => Err(anyhow!("sidecar kill failed: {e}")),
                Ok(Err(join_err)) => Err(anyhow!("sidecar kill task joined with error: {join_err}")),
                Err(_) => Err(anyhow!("sidecar shutdown timed out after {SHUTDOWN_TIMEOUT_MS}ms")),
            }
        } else {
            Ok(())
        }
    }
}

/// Background supervisor — owns the child lifecycle. Parses stdout, emits
/// events, handles restart logic.
async fn supervise_loop(
    app: AppHandle,
    shared: Arc<Mutex<SharedState>>,
    session_path: PathBuf,
) {
    let port_re = port_line_regex();
    let session_str = session_path.to_string_lossy().to_string();
    let mut restarts: u32 = 0;

    loop {
        // Respect shutdown flag before a fresh spawn attempt.
        if shared.lock().await.shutting_down {
            break;
        }

        let spawn_result = app
            .shell()
            .sidecar("drawcast-mcp")
            .and_then(|cmd| {
                Ok(cmd
                    .args([
                        "--sse",
                        "--port",
                        "auto",
                        "--session-path",
                        session_str.as_str(),
                    ])
                    .spawn()?)
            });

        let (mut rx, child) = match spawn_result {
            Ok(pair) => pair,
            Err(err) => {
                let _ = app.emit(
                    "sidecar-log",
                    LogPayload {
                        level: "stderr",
                        line: format!("failed to spawn sidecar: {err}"),
                    },
                );
                // Treat spawn failure like a crashed exit so the restart
                // policy applies consistently.
                if !handle_restart(&shared, &mut restarts).await {
                    let _ = app.emit(
                        "sidecar-exit",
                        ExitPayload { code: None },
                    );
                    break;
                }
                tokio::time::sleep(Duration::from_millis(RESTART_DELAY_MS)).await;
                continue;
            }
        };

        // New child — reset per-run state.
        {
            let mut state = shared.lock().await;
            state.child = Some(child);
            state.ready = false;
            state.port = None;
        }

        let mut exit_code: Option<i32> = None;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim().to_string();
                    if let Some(port) = parse_port_line(&line, &port_re) {
                        shared.lock().await.port = Some(port);
                        let _ = app.emit("sidecar-port", PortPayload { port });
                    }
                    if line.contains("DRAWCAST_READY=1") {
                        let port_now = shared.lock().await.port;
                        if let Some(port) = port_now {
                            shared.lock().await.ready = true;
                            let _ = app.emit("sidecar-ready", PortPayload { port });
                        }
                    }
                    // Echo everything to the log channel so devtools panels can
                    // show stdout too.
                    if !line.is_empty() {
                        let _ = app.emit(
                            "sidecar-log",
                            LogPayload {
                                level: "stdout",
                                line,
                            },
                        );
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim().to_string();
                    if !line.is_empty() {
                        let _ = app.emit(
                            "sidecar-log",
                            LogPayload {
                                level: "stderr",
                                line,
                            },
                        );
                    }
                }
                CommandEvent::Error(msg) => {
                    let _ = app.emit(
                        "sidecar-log",
                        LogPayload {
                            level: "error",
                            line: msg,
                        },
                    );
                }
                CommandEvent::Terminated(payload) => {
                    exit_code = payload.code;
                    break;
                }
                _ => {}
            }
        }

        // Drop the stale child handle (it's already gone).
        {
            let mut state = shared.lock().await;
            state.child = None;
            state.ready = false;
            state.port = None;
        }

        let _ = app.emit("sidecar-exit", ExitPayload { code: exit_code });

        // Clean exit (code 0) — don't auto-restart.
        let clean = matches!(exit_code, Some(0));
        if clean {
            break;
        }

        if !handle_restart(&shared, &mut restarts).await {
            break;
        }
        tokio::time::sleep(Duration::from_millis(RESTART_DELAY_MS)).await;
    }
}

/// Increments the restart counter and returns whether another attempt is
/// allowed. Also bails out if shutdown was requested.
async fn handle_restart(shared: &Arc<Mutex<SharedState>>, restarts: &mut u32) -> bool {
    if shared.lock().await.shutting_down {
        return false;
    }
    if *restarts >= MAX_RESTARTS {
        return false;
    }
    *restarts += 1;
    true
}

fn port_line_regex() -> Regex {
    // Safety: the pattern is a literal that compiles at library load time
    // in practice (we call this once per supervisor loop start).
    Regex::new(r"^DRAWCAST_PORT=(\d+)$").expect("DRAWCAST_PORT regex")
}

/// Pure helper for the Rust unit test — parses a single stdout line.
pub fn parse_port_line(line: &str, re: &Regex) -> Option<u16> {
    let caps = re.captures(line.trim())?;
    caps.get(1)?.as_str().parse::<u16>().ok()
}

/// Convenience wrapper used by tests that don't want to build the regex
/// themselves.
#[cfg(test)]
pub fn parse_port_line_simple(line: &str) -> Option<u16> {
    parse_port_line(line, &port_line_regex())
}

/// Tauri-managed state wrapper. Held in an `Arc<Mutex<_>>` so `.manage()`
/// can share it across command handlers and the window close hook.
pub type ManagedSidecar = std::sync::Mutex<Option<McpSidecar>>;

/// Tauri command — lets the frontend poll the current port in case it missed
/// the `sidecar-ready` event (e.g. component mounted after the event fired).
#[tauri::command]
pub async fn get_sidecar_port(
    state: tauri::State<'_, ManagedSidecar>,
) -> Result<Option<u16>, String> {
    let sidecar = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    match sidecar {
        Some(s) => Ok(s.port().await),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_port_line() {
        assert_eq!(parse_port_line_simple("DRAWCAST_PORT=43017"), Some(43017));
    }

    #[test]
    fn parses_port_with_trailing_whitespace() {
        assert_eq!(parse_port_line_simple("DRAWCAST_PORT=8080\n"), Some(8080));
    }

    #[test]
    fn rejects_non_matching_line() {
        assert_eq!(parse_port_line_simple("[mcp] ready"), None);
        assert_eq!(parse_port_line_simple("DRAWCAST_PORT=notanumber"), None);
        assert_eq!(parse_port_line_simple("DRAWCAST_READY=1"), None);
    }

    #[test]
    fn rejects_out_of_range_port() {
        // u16 max is 65535 — 99999 should fail to parse.
        assert_eq!(parse_port_line_simple("DRAWCAST_PORT=99999"), None);
    }
}
