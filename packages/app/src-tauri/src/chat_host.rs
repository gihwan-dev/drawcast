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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use serde_json::{json, Value as JsonValue};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

/// Bound on how long `shutdown()` waits for the supervisor to reap the child.
/// Long enough for `claude` to flush an in-flight turn after SIGTERM, short
/// enough that a wedged child can't block window close or session switch.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

/// Emitted when the child exits. `code` is the raw exit status or `None` if
/// the OS killed the process with a signal.
#[derive(Clone, Serialize)]
struct ExitPayload {
    code: Option<i32>,
}

/// Public handle to the running chat child. Held in Tauri state as
/// `ManagedChatHost` so commands can share it with the window-close hook.
///
/// Ownership model: the `Child` is owned exclusively by a supervisor task
/// spawned in `spawn()`. Other code never locks the child — it communicates
/// with the supervisor by sending on `cancel_tx` and awaiting `done_rx`.
/// This avoids the deadlock the prior `Arc<Mutex<Option<Child>>>` design hit
/// when `shutdown()` raced the supervisor's `child.wait().await` for the
/// same lock.
pub struct ChatHost {
    /// Sends a one-shot cancel signal to the supervisor task. `take()`-ed on
    /// the first `shutdown()` call so subsequent calls are no-ops.
    cancel_tx: Mutex<Option<oneshot::Sender<()>>>,
    /// Resolves once the supervisor has reaped the child and emitted
    /// `chat-exit`. Lets `shutdown()` block (with a timeout) on full teardown
    /// before returning, which the window-close hook relies on.
    done_rx: Mutex<Option<oneshot::Receiver<()>>>,
    /// Stdin handle for `write_line`. Dropped on shutdown so the child sees
    /// EOF, which lets a well-behaved `claude` exit cleanly without a kill.
    stdin: Mutex<Option<ChildStdin>>,
    /// Liveness flag flipped by the supervisor on exit. Lock-free read for
    /// the hot `is_alive()` path used by `ensure_chat_running`.
    alive: Arc<AtomicBool>,
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

        // Append drawcast's diagram-generation guideline to Claude's default
        // system prompt. Non-fatal: if the bundled resource can't be read we
        // fall back to Claude's default behaviour and log a dev-console
        // warning so the missing file shows up without blocking chat.
        match load_bundled_system_prompt(app) {
            Ok(prompt) => {
                cmd.arg("--append-system-prompt").arg(prompt);
            }
            Err(err) => {
                let _ = app.emit(
                    "chat-raw-line",
                    json!({
                        "stream": "stderr",
                        "line": format!(
                            "drawcast: system prompt resource unavailable ({err}); \
                             continuing with Claude default"
                        ),
                    }),
                );
            }
        }

        cmd.kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .with_context(|| format!("spawn {}", bin.display()))?;

        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

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

        let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
        let (done_tx, done_rx) = oneshot::channel::<()>();
        let alive = Arc::new(AtomicBool::new(true));
        let alive_for_task = alive.clone();
        let app_for_exit = app.clone();

        // Supervisor: sole owner of `child`. Races a cancel signal against
        // the natural exit so neither `shutdown()` nor `wait()` ever needs to
        // hold a lock on the child. On cancel we send SIGTERM via
        // `start_kill` and still `wait()` to reap, so we don't leave a zombie.
        tauri::async_runtime::spawn(async move {
            let exit_code = tokio::select! {
                _ = cancel_rx => {
                    let _ = child.start_kill();
                    child.wait().await.ok().and_then(|s| s.code())
                }
                res = child.wait() => res.ok().and_then(|s| s.code()),
            };
            alive_for_task.store(false, Ordering::SeqCst);
            // `done_tx` may have no receiver if `shutdown()` timed out and
            // dropped the rx — that's fine, send is best-effort.
            let _ = done_tx.send(());
            let _ = app_for_exit.emit("chat-exit", ExitPayload { code: exit_code });
        });

        Ok(Self {
            cancel_tx: Mutex::new(Some(cancel_tx)),
            done_rx: Mutex::new(Some(done_rx)),
            stdin: Mutex::new(stdin),
            alive,
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

    /// Graceful shutdown — close stdin (so a well-behaved child exits on
    /// EOF), signal the supervisor to cancel, then await reap with a timeout.
    /// Idempotent: a second call after exit no-ops because both `cancel_tx`
    /// and `done_rx` are `take()`-ed on first use.
    pub async fn shutdown(&self) -> Result<()> {
        // Drop stdin first. If the child exits cleanly on EOF, the
        // supervisor's `wait()` arm of the select wins naturally and the
        // cancel signal below is harmlessly ignored.
        {
            let mut guard = self.stdin.lock().await;
            *guard = None;
        }
        if let Some(tx) = self.cancel_tx.lock().await.take() {
            // Send error means the supervisor already exited — that's fine.
            let _ = tx.send(());
        }
        let rx = self.done_rx.lock().await.take();
        if let Some(rx) = rx {
            // Bound the wait so a wedged child can't block window close or
            // session switch. After timeout `kill_on_drop(true)` on the
            // Command still cleans up if `ChatHost` is dropped.
            let _ = tokio::time::timeout(SHUTDOWN_TIMEOUT, rx).await;
        }
        Ok(())
    }

    /// `false` after the supervisor has reaped the child. `chat_send` checks
    /// this to decide whether to respawn, so it must be cheap — backed by an
    /// `AtomicBool` rather than a mutex.
    pub async fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
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

/// Relative path (inside the Tauri resource dir) of the bundled guideline.
/// Kept as a constant so tests and the spawn path can't drift.
const SYSTEM_PROMPT_RESOURCE: &str = "resources/system-prompt.md";

/// Read the bundled drawcast system prompt out of the Tauri resource dir.
///
/// Dev builds resolve against `src-tauri/`; packaged builds resolve against
/// the platform-specific `Resources/` directory that Tauri populates from
/// `tauri.conf.json` → `bundle.resources`. An empty file is treated as a
/// misconfiguration so we don't feed a zero-length string to
/// `--append-system-prompt` (Claude CLI rejects it).
fn load_bundled_system_prompt(app: &AppHandle) -> Result<String> {
    let path = app
        .path()
        .resolve(SYSTEM_PROMPT_RESOURCE, BaseDirectory::Resource)
        .with_context(|| format!("resolve resource {SYSTEM_PROMPT_RESOURCE}"))?;
    read_system_prompt_file(&path)
}

/// Pure helper split out for unit tests — reads and validates the prompt
/// file independently of Tauri's resource resolver.
fn read_system_prompt_file(path: &Path) -> Result<String> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("read {}", path.display()))?;
    if raw.trim().is_empty() {
        return Err(anyhow!("system prompt file is empty: {}", path.display()));
    }
    Ok(raw)
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
    fn read_system_prompt_file_returns_contents() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("system-prompt.md");
        std::fs::write(&path, "drawcast agent guideline\n").unwrap();
        let content = read_system_prompt_file(&path).unwrap();
        assert!(content.contains("drawcast agent guideline"));
    }

    #[test]
    fn read_system_prompt_file_rejects_empty_and_whitespace_only() {
        let dir = tempfile::tempdir().unwrap();
        let empty = dir.path().join("empty.md");
        std::fs::write(&empty, "").unwrap();
        assert!(read_system_prompt_file(&empty).is_err());

        let blank = dir.path().join("blank.md");
        std::fs::write(&blank, "\n  \t\n").unwrap();
        assert!(read_system_prompt_file(&blank).is_err());
    }

    #[test]
    fn read_system_prompt_file_errors_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("does-not-exist.md");
        assert!(read_system_prompt_file(&missing).is_err());
    }

    #[test]
    fn bundled_system_prompt_resource_is_valid() {
        // The real file shipped with the crate — guards against an empty
        // commit or accidental deletion of the resource.
        let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let path = crate_root.join(SYSTEM_PROMPT_RESOURCE);
        let content = read_system_prompt_file(&path).unwrap_or_else(|e| {
            panic!("bundled system prompt must load: {e}")
        });
        assert!(
            content.contains("drawcast-system-prompt version"),
            "system-prompt.md must carry the versioned header comment"
        );
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
