//! Spawns and supervises an interactive CLI child process (Claude Code or
//! Codex). I/O is piped over ordinary OS pipes and forwarded to the frontend
//! via Tauri events — **no real PTY** in this PR. This is a documented
//! limitation: many CLI tools detect whether stdout is a TTY and disable
//! colors / raw-mode input when the answer is "no". Real PTY support via the
//! `portable-pty` crate is a post-MVP enhancement.
//!
//! Event contract (producer → frontend):
//! - `cli-output` → `{ stream: "stdout" | "stderr", data: string }`
//! - `cli-exit`   → `{ code: number | null }`
//!
//! Command resolution prefers `PATH` then well-known install locations so the
//! app can find a CLI installed through Homebrew, nvm, or Claude's own
//! installer (`~/.claude/local/claude`).
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;

/// Which CLI to spawn.
#[derive(Debug, Clone, Copy)]
pub enum CliKind {
    Claude,
    Codex,
}

impl CliKind {
    pub fn from_str(value: &str) -> Result<Self> {
        match value {
            "claude-code" | "claude" => Ok(CliKind::Claude),
            "codex" => Ok(CliKind::Codex),
            other => Err(anyhow!("unknown CLI kind: {other}")),
        }
    }

    fn display(self) -> &'static str {
        match self {
            CliKind::Claude => "Claude Code",
            CliKind::Codex => "Codex",
        }
    }
}

#[derive(Clone, Serialize)]
struct OutputPayload {
    stream: &'static str,
    data: String,
}

#[derive(Clone, Serialize)]
struct ExitPayload {
    code: Option<i32>,
}

/// Public handle to a running CLI.
pub struct CliHost {
    /// Future use: StatusBar badge reads which CLI is running. `#[allow]`
    /// keeps the build warning-clean until we add a Tauri command that
    /// surfaces this.
    #[allow(dead_code)]
    which: CliKind,
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
}

impl CliHost {
    #[allow(dead_code)]
    pub fn which(&self) -> CliKind {
        self.which
    }

    /// Spawn the requested CLI with the given working directory. Emits
    /// `cli-output` events for stdout/stderr chunks and a final `cli-exit`
    /// when the child terminates.
    pub fn spawn(app: &AppHandle, which: CliKind, session_path: PathBuf) -> Result<Self> {
        let binary = resolve_binary(which)
            .with_context(|| format!("couldn't find {} binary", which.display()))?;

        let mut cmd = Command::new(&binary);
        cmd.current_dir(&session_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Best-effort: some CLIs check TERM when deciding whether to emit
            // color codes. We default to xterm-256color so the output matches
            // what the user would see in a real terminal — xterm.js renders
            // the ANSI sequences fine.
            .env("TERM", "xterm-256color");
        cmd.kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .with_context(|| format!("spawn {}", binary.display()))?;

        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let child_arc = Arc::new(Mutex::new(Some(child)));
        let stdin_arc = Arc::new(Mutex::new(stdin));

        // Reader tasks — one per stream. They emit chunk-by-chunk so raw
        // ANSI escapes pass through without line-buffering.
        if let Some(mut out) = stdout {
            let app_for_task = app.clone();
            tauri::async_runtime::spawn(async move {
                pipe_stream(&mut out, "stdout", &app_for_task).await;
            });
        }
        if let Some(mut err) = stderr {
            let app_for_task = app.clone();
            tauri::async_runtime::spawn(async move {
                pipe_stream(&mut err, "stderr", &app_for_task).await;
            });
        }

        // Waiter task — emits `cli-exit` once the child terminates.
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
            // Drop the child handle so `shutdown` becomes a no-op.
            {
                let mut guard = child_for_wait.lock().await;
                *guard = None;
            }
            let _ = app_for_exit.emit("cli-exit", ExitPayload { code });
        });

        Ok(Self {
            which,
            child: child_arc,
            stdin: stdin_arc,
        })
    }

    /// Write the given data to the child's stdin.
    pub async fn write_stdin(&self, data: &str) -> Result<()> {
        let mut guard = self.stdin.lock().await;
        let stdin = guard
            .as_mut()
            .ok_or_else(|| anyhow!("CLI stdin is closed"))?;
        stdin
            .write_all(data.as_bytes())
            .await
            .context("write stdin")?;
        stdin.flush().await.context("flush stdin")?;
        Ok(())
    }

    /// PTY resize no-op — piped stdio has no concept of terminal size. Logged
    /// so observability tooling can see how often the frontend asks.
    #[allow(clippy::unused_async)]
    pub async fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        #[cfg(debug_assertions)]
        eprintln!(
            "[cli_host] resize request ({cols}x{rows}) ignored — no PTY in PR #14",
        );
        let _ = (cols, rows);
        Ok(())
    }

    /// Kill the child and drop handles.
    pub async fn shutdown(&self) -> Result<()> {
        {
            let mut guard = self.stdin.lock().await;
            *guard = None;
        }
        let mut guard = self.child.lock().await;
        if let Some(mut child) = guard.take() {
            child.start_kill().context("start_kill")?;
            let _ = child.wait().await;
        }
        Ok(())
    }
}

async fn pipe_stream<R>(reader: &mut R, stream: &'static str, app: &AppHandle)
where
    R: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;
    let mut buf = vec![0u8; 4096];
    loop {
        let n = match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
        let _ = app.emit(
            "cli-output",
            OutputPayload {
                stream,
                data: chunk,
            },
        );
    }
}

/// Resolve the CLI binary. Preference order:
/// 1. On `PATH` (via `which`) — honours the user's shell config.
/// 2. Well-known fallbacks for each CLI.
fn resolve_binary(which: CliKind) -> Result<PathBuf> {
    let names: &[&str] = match which {
        CliKind::Claude => &["claude"],
        CliKind::Codex => &["codex"],
    };
    for name in names {
        if let Some(found) = which_in_path(name) {
            return Ok(found);
        }
    }

    let fallbacks: &[&str] = match which {
        CliKind::Claude => {
            // Claude's official installer drops a shim at ~/.claude/local/claude.
            // We also check Homebrew and /usr/local for good measure.
            &[
                "~/.claude/local/claude",
                "/opt/homebrew/bin/claude",
                "/usr/local/bin/claude",
            ]
        }
        CliKind::Codex => &[
            "/opt/homebrew/bin/codex",
            "/usr/local/bin/codex",
        ],
    };
    for f in fallbacks {
        let expanded = expand_tilde(f);
        if expanded.exists() {
            return Ok(expanded);
        }
    }
    Err(anyhow!(
        "no {} binary found on PATH or in standard locations",
        which.display()
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

/// Tauri-managed state wrapper so commands and the window close hook share a
/// single CliHost across handlers.
pub type ManagedCliHost = tokio::sync::Mutex<Option<CliHost>>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_kind_from_str_accepts_aliases() {
        assert!(matches!(
            CliKind::from_str("claude-code").unwrap(),
            CliKind::Claude
        ));
        assert!(matches!(
            CliKind::from_str("claude").unwrap(),
            CliKind::Claude
        ));
        assert!(matches!(
            CliKind::from_str("codex").unwrap(),
            CliKind::Codex
        ));
        assert!(CliKind::from_str("bash").is_err());
    }

    #[test]
    fn expand_tilde_uses_home_dir() {
        let expanded = expand_tilde("~/drawcast-test-path");
        let home = dirs::home_dir().expect("home_dir");
        assert_eq!(expanded, home.join("drawcast-test-path"));
    }

    #[test]
    fn expand_tilde_passes_non_tilde_paths_through() {
        let expanded = expand_tilde("/absolute/path");
        assert_eq!(expanded, PathBuf::from("/absolute/path"));
    }
}
