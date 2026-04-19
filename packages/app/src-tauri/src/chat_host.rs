//! Long-running `claude` CLI supervisor for the chat panel.
//!
//! We drive Claude via `claude -p --input-format stream-json --output-format
//! stream-json --verbose`, piping NDJSON on stdin/stdout. One child per chat
//! session stays alive across turns so the same conversation continues
//! without the ~12s respawn overhead the Agent SDK incurs per call.
//!
//! Authentication is fully delegated to the user's `~/.claude/` OAuth session
//! (`claude login`). We never read or inject `ANTHROPIC_API_KEY`, so calls
//! bill against the user's Pro/Max subscription when they have one. The
//! `init` NDJSON event emits `apiKeySource: "none"` which the StatusBar can
//! use to confirm the expected path.
//!
//! Event contract (producer → frontend):
//!
//! - `chat-event`    — one per NDJSON line. Payload is the parsed JSON value
//!                      from the stream (`{"type":"system",...}`,
//!                      `{"type":"assistant",...}`, `{"type":"result",...}`,
//!                      `{"type":"rate_limit_event",...}`, etc.). The
//!                      frontend dispatches by the inner `type`/`subtype`
//!                      fields. Keeps Rust dumb about schema drift.
//! - `chat-raw-line` — lines we couldn't parse as JSON (usually stderr or
//!                      the rare stdout warning). Payload: `{ stream, line }`.
//!                      Surfaced to devtools only.
//! - `chat-exit`     — child terminated. Payload: `{ code }`.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use serde_json::{json, Value as JsonValue};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;

/// Emitted when the child exits. `code` is the raw exit status or `None` if
/// the OS killed the process with a signal.
#[derive(Clone, Serialize)]
struct ExitPayload {
    code: Option<i32>,
}

/// Public handle to the running chat child. Held in Tauri state as
/// `ManagedChatHost` so commands can share it with the window-close hook.
pub struct ChatHost {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    session_path: PathBuf,
}

impl ChatHost {
    /// Spawn `claude` in the session cwd.
    ///
    /// When `sidecar_port` is provided we write a session-local
    /// `.drawcast-mcp.json` and pass it via `--mcp-config`. This is how the
    /// child picks up our MCP server without us editing the user's global
    /// `~/.claude.json`.
    pub fn spawn(
        app: &AppHandle,
        session_path: PathBuf,
        sidecar_port: Option<u16>,
    ) -> Result<Self> {
        let bin = resolve_claude_binary()
            .context("couldn't find `claude` binary on PATH or standard install locations")?;

        let mut cmd = Command::new(&bin);
        cmd.current_dir(&session_path)
            .args([
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--replay-user-messages",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(port) = sidecar_port {
            let mcp_config_path = session_path.join(".drawcast-mcp.json");
            write_mcp_config(&mcp_config_path, port).with_context(|| {
                format!("write mcp config {}", mcp_config_path.display())
            })?;
            cmd.arg("--mcp-config")
                .arg(mcp_config_path.to_string_lossy().to_string());
        }

        cmd.kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .with_context(|| format!("spawn {}", bin.display()))?;

        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let child_arc = Arc::new(Mutex::new(Some(child)));
        let stdin_arc = Arc::new(Mutex::new(stdin));

        if let Some(out) = stdout {
            let app_for_task = app.clone();
            tauri::async_runtime::spawn(async move {
                read_ndjson_lines(out, &app_for_task).await;
            });
        }
        if let Some(err) = stderr {
            let app_for_task = app.clone();
            tauri::async_runtime::spawn(async move {
                read_stderr_lines(err, &app_for_task).await;
            });
        }

        let app_for_exit = app.clone();
        let child_for_wait = child_arc.clone();
        tauri::async_runtime::spawn(async move {
            let code = {
                let mut guard = child_for_wait.lock().await;
                match guard.as_mut() {
                    Some(c) => match c.wait().await {
                        Ok(status) => status.code(),
                        Err(_) => None,
                    },
                    None => None,
                }
            };
            {
                let mut guard = child_for_wait.lock().await;
                *guard = None;
            }
            let _ = app_for_exit.emit("chat-exit", ExitPayload { code });
        });

        Ok(Self {
            child: child_arc,
            stdin: stdin_arc,
            session_path,
        })
    }

    /// Append a single NDJSON line to the child's stdin. The caller is
    /// responsible for producing a valid stream-json envelope (usually
    /// `{"type":"user","message":{"role":"user","content":[...]}}`). A
    /// trailing newline is added if missing.
    pub async fn write_line(&self, line: &str) -> Result<()> {
        let mut guard = self.stdin.lock().await;
        let stdin = guard
            .as_mut()
            .ok_or_else(|| anyhow!("chat child stdin is closed"))?;
        stdin
            .write_all(line.as_bytes())
            .await
            .context("write chat stdin")?;
        if !line.ends_with('\n') {
            stdin.write_all(b"\n").await.context("write newline")?;
        }
        stdin.flush().await.context("flush chat stdin")?;
        Ok(())
    }

    /// Graceful shutdown — close stdin (signals EOF), then best-effort kill.
    pub async fn shutdown(&self) -> Result<()> {
        {
            let mut guard = self.stdin.lock().await;
            *guard = None;
        }
        let mut guard = self.child.lock().await;
        if let Some(mut child) = guard.take() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
        Ok(())
    }

    /// `false` after the child has exited (or been killed). The waiter
    /// task nulls the internal slot on exit, so `chat_send` can detect a
    /// dead host and respawn on the next turn without the frontend having
    /// to orchestrate an explicit "start".
    pub async fn is_alive(&self) -> bool {
        self.child.lock().await.is_some()
    }

    #[allow(dead_code)]
    pub fn session_path(&self) -> &Path {
        &self.session_path
    }
}

/// Tauri-managed state slot. Commands + window-close hook share this.
pub type ManagedChatHost = tokio::sync::Mutex<Option<ChatHost>>;

/// Onboarding probe — returns `true` iff `claude` is discoverable. Shares
/// `resolve_claude_binary` so Welcome's "detected" hint and spawn agree.
pub fn is_claude_installed() -> bool {
    resolve_claude_binary().is_ok()
}

async fn read_ndjson_lines<R>(reader: R, app: &AppHandle)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let mut lines = BufReader::new(reader).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<JsonValue>(&line) {
                    Ok(value) => {
                        let _ = app.emit("chat-event", value);
                    }
                    Err(_) => {
                        let _ = app.emit(
                            "chat-raw-line",
                            json!({ "stream": "stdout", "line": line }),
                        );
                    }
                }
            }
            Ok(None) => break,
            Err(_) => break,
        }
    }
}

async fn read_stderr_lines<R>(reader: R, app: &AppHandle)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let mut lines = BufReader::new(reader).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                if line.trim().is_empty() {
                    continue;
                }
                let _ = app.emit(
                    "chat-raw-line",
                    json!({ "stream": "stderr", "line": line }),
                );
            }
            _ => break,
        }
    }
}

/// Resolve the `claude` binary. Preference order:
///   1. PATH (honours the user's shell config).
///   2. `~/.claude/local/claude` (Claude installer shim).
///   3. Homebrew / `/usr/local`.
pub fn resolve_claude_binary() -> Result<PathBuf> {
    if let Some(found) = which_in_path("claude") {
        return Ok(found);
    }
    let fallbacks: &[&str] = &[
        "~/.claude/local/claude",
        "/opt/homebrew/bin/claude",
        "/usr/local/bin/claude",
    ];
    for f in fallbacks {
        let expanded = expand_tilde(f);
        if expanded.is_file() {
            return Ok(expanded);
        }
    }
    Err(anyhow!(
        "no `claude` binary found on PATH or in standard install locations"
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

fn expand_tilde(raw: &str) -> PathBuf {
    if let Some(stripped) = raw.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    }
    PathBuf::from(raw)
}

fn write_mcp_config(path: &Path, sidecar_port: u16) -> Result<()> {
    let cfg = json!({
        "mcpServers": {
            "drawcast": {
                "type": "sse",
                "url": format!("http://127.0.0.1:{sidecar_port}/sse")
            }
        }
    });
    let serialized = serde_json::to_string_pretty(&cfg)?;
    std::fs::write(path, serialized)
        .with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_tilde_uses_home_dir() {
        let expanded = expand_tilde("~/drawcast-test-path");
        let home = dirs::home_dir().expect("home_dir");
        assert_eq!(expanded, home.join("drawcast-test-path"));
    }

    #[test]
    fn expand_tilde_passes_absolute_paths_through() {
        let expanded = expand_tilde("/absolute/path");
        assert_eq!(expanded, PathBuf::from("/absolute/path"));
    }

    #[test]
    fn write_mcp_config_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".drawcast-mcp.json");
        write_mcp_config(&path, 12345).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        let parsed: JsonValue = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            parsed["mcpServers"]["drawcast"]["type"],
            JsonValue::String("sse".into())
        );
        assert_eq!(
            parsed["mcpServers"]["drawcast"]["url"],
            JsonValue::String("http://127.0.0.1:12345/sse".into())
        );
    }
}
