//! Direct MCP registration for Claude Code and Codex config files.
//!
//! Mirrors the functionality of `drawcast-mcp config register-cli <which>` but
//! runs inside the Tauri app so the frontend doesn't need to spawn the sidecar
//! CLI just to edit a config file. The registration is **idempotent** —
//! clicking "Connect" repeatedly on an already-wired config reports
//! `AlreadyPresent` and leaves the file untouched.
//!
//! Supported targets:
//! - **Claude Code**: `~/.claude.json` — `mcpServers.drawcast = { command, args }`.
//! - **Codex**: `~/.codex/config.toml` — `mcp_servers.drawcast = { command, args }`.
//!
//! The Codex config key is a best-effort guess; the CLI's real schema may use
//! a different table name. Users can override in the Codex config manually if
//! this lands in the wrong place — the UI surfaces the result so they know
//! what was written.
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use serde_json::{json, Value as JsonValue};

/// Whether the registration wrote new data, updated existing data, or was a
/// no-op because the config already matched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RegistrationStatus {
    Added,
    Updated,
    AlreadyPresent,
}

impl RegistrationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            RegistrationStatus::Added => "added",
            RegistrationStatus::Updated => "updated",
            RegistrationStatus::AlreadyPresent => "already-present",
        }
    }
}

fn home_dir() -> Result<PathBuf> {
    dirs::home_dir().ok_or_else(|| anyhow!("unable to resolve home directory"))
}

/// Register Drawcast in the user's `~/.claude.json`.
pub async fn register_claude(sidecar_bin: &Path) -> Result<RegistrationStatus> {
    let home = home_dir()?;
    register_claude_at(&home, sidecar_bin).await
}

/// Register Drawcast in the user's `~/.codex/config.toml`.
pub async fn register_codex(sidecar_bin: &Path) -> Result<RegistrationStatus> {
    let home = home_dir()?;
    register_codex_at(&home, sidecar_bin).await
}

/// Testable variant — accepts an explicit `home` directory override.
pub async fn register_claude_at(
    home: &Path,
    sidecar_bin: &Path,
) -> Result<RegistrationStatus> {
    let config_path = home.join(".claude.json");
    let bin_str = path_to_string(sidecar_bin)?;

    // Load existing JSON or start fresh.
    let raw = read_optional(&config_path).await?;
    let mut root: JsonValue = match raw {
        Some(text) if !text.trim().is_empty() => serde_json::from_str(&text)
            .with_context(|| format!("parse {}", config_path.display()))?,
        _ => JsonValue::Object(Default::default()),
    };

    if !root.is_object() {
        return Err(anyhow!(
            "{} must be a JSON object",
            config_path.display()
        ));
    }

    let obj = root.as_object_mut().expect("verified object above");
    let servers_entry = obj
        .entry("mcpServers".to_string())
        .or_insert_with(|| JsonValue::Object(Default::default()));
    if !servers_entry.is_object() {
        return Err(anyhow!(
            "{}: mcpServers must be an object",
            config_path.display()
        ));
    }

    let desired = json!({
        "command": bin_str,
        "args": ["--stdio"],
    });

    let servers = servers_entry.as_object_mut().expect("verified object above");
    let status = match servers.get("drawcast") {
        Some(existing) if existing == &desired => RegistrationStatus::AlreadyPresent,
        Some(_) => RegistrationStatus::Updated,
        None => RegistrationStatus::Added,
    };

    if status == RegistrationStatus::AlreadyPresent {
        return Ok(status);
    }

    servers.insert("drawcast".to_string(), desired);

    if let Some(parent) = config_path.parent() {
        if !parent.as_os_str().is_empty() {
            tokio::fs::create_dir_all(parent)
                .await
                .with_context(|| format!("mkdir {}", parent.display()))?;
        }
    }

    let serialized = format!("{}\n", serde_json::to_string_pretty(&root)?);
    write_atomic(&config_path, serialized.as_bytes()).await?;
    Ok(status)
}

/// Testable variant — accepts an explicit `home` directory override.
pub async fn register_codex_at(
    home: &Path,
    sidecar_bin: &Path,
) -> Result<RegistrationStatus> {
    let config_dir = home.join(".codex");
    let config_path = config_dir.join("config.toml");
    let bin_str = path_to_string(sidecar_bin)?;

    let existing = read_optional(&config_path).await?;
    let mut doc: toml::Table = match existing {
        Some(text) if !text.trim().is_empty() => text
            .parse::<toml::Table>()
            .with_context(|| format!("parse {}", config_path.display()))?,
        _ => toml::Table::new(),
    };

    let servers_entry = doc
        .entry("mcp_servers".to_string())
        .or_insert_with(|| toml::Value::Table(toml::Table::new()));
    let servers = match servers_entry {
        toml::Value::Table(t) => t,
        _ => {
            return Err(anyhow!(
                "{}: mcp_servers must be a table",
                config_path.display()
            ))
        }
    };

    let mut desired = toml::Table::new();
    desired.insert("command".into(), toml::Value::String(bin_str.clone()));
    desired.insert(
        "args".into(),
        toml::Value::Array(vec![toml::Value::String("--stdio".into())]),
    );
    let desired_value = toml::Value::Table(desired);

    let status = match servers.get("drawcast") {
        Some(existing) if toml_eq(existing, &desired_value) => {
            RegistrationStatus::AlreadyPresent
        }
        Some(_) => RegistrationStatus::Updated,
        None => RegistrationStatus::Added,
    };

    if status == RegistrationStatus::AlreadyPresent {
        return Ok(status);
    }

    servers.insert("drawcast".into(), desired_value);

    tokio::fs::create_dir_all(&config_dir)
        .await
        .with_context(|| format!("mkdir {}", config_dir.display()))?;

    let serialized = format!("{}", toml::to_string_pretty(&doc)?);
    write_atomic(&config_path, serialized.as_bytes()).await?;
    Ok(status)
}

fn path_to_string(path: &Path) -> Result<String> {
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("sidecar path is not valid UTF-8: {}", path.display()))
}

async fn read_optional(path: &Path) -> Result<Option<String>> {
    match tokio::fs::read_to_string(path).await {
        Ok(text) => Ok(Some(text)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err).with_context(|| format!("read {}", path.display())),
    }
}

async fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = {
        let mut name = path
            .file_name()
            .ok_or_else(|| anyhow!("path has no file name: {}", path.display()))?
            .to_owned();
        name.push(format!(
            ".{}.{}.tmp",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        path.with_file_name(name)
    };

    tokio::fs::write(&tmp, bytes)
        .await
        .with_context(|| format!("write tmp {}", tmp.display()))?;

    match tokio::fs::rename(&tmp, path).await {
        Ok(()) => Ok(()),
        Err(err) => {
            let _ = tokio::fs::remove_file(&tmp).await;
            Err(err).with_context(|| format!("rename tmp -> {}", path.display()))
        }
    }
}

fn toml_eq(a: &toml::Value, b: &toml::Value) -> bool {
    // toml 0.8's Value implements PartialEq, but float NaN semantics can bite
    // — for config values we're safe because we only compare strings and
    // arrays of strings. Still, route through the derived equality.
    a == b
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sidecar_bin() -> PathBuf {
        PathBuf::from("/opt/drawcast/drawcast-mcp")
    }

    #[tokio::test]
    async fn register_claude_on_missing_file_writes_config() {
        let home = tempdir().unwrap();
        let status = register_claude_at(home.path(), &sidecar_bin())
            .await
            .expect("register_claude_at");
        assert_eq!(status, RegistrationStatus::Added);

        let raw = std::fs::read_to_string(home.path().join(".claude.json")).unwrap();
        let parsed: JsonValue = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            parsed["mcpServers"]["drawcast"]["command"],
            json!("/opt/drawcast/drawcast-mcp"),
        );
        assert_eq!(
            parsed["mcpServers"]["drawcast"]["args"],
            json!(["--stdio"]),
        );
    }

    #[tokio::test]
    async fn register_claude_preserves_other_keys() {
        let home = tempdir().unwrap();
        let path = home.path().join(".claude.json");
        std::fs::write(
            &path,
            r#"{ "theme": "dark", "mcpServers": { "other": { "command": "x" } } }"#,
        )
        .unwrap();

        let status = register_claude_at(home.path(), &sidecar_bin())
            .await
            .expect("register_claude_at");
        assert_eq!(status, RegistrationStatus::Added);

        let raw = std::fs::read_to_string(&path).unwrap();
        let parsed: JsonValue = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["theme"], json!("dark"));
        assert_eq!(parsed["mcpServers"]["other"]["command"], json!("x"));
        assert_eq!(
            parsed["mcpServers"]["drawcast"]["command"],
            json!("/opt/drawcast/drawcast-mcp"),
        );
    }

    #[tokio::test]
    async fn register_claude_is_idempotent() {
        let home = tempdir().unwrap();
        let first = register_claude_at(home.path(), &sidecar_bin())
            .await
            .expect("first");
        assert_eq!(first, RegistrationStatus::Added);

        let second = register_claude_at(home.path(), &sidecar_bin())
            .await
            .expect("second");
        assert_eq!(second, RegistrationStatus::AlreadyPresent);
    }

    #[tokio::test]
    async fn register_claude_reports_update_when_command_differs() {
        let home = tempdir().unwrap();
        let path = home.path().join(".claude.json");
        std::fs::write(
            &path,
            r#"{ "mcpServers": { "drawcast": { "command": "/old/path", "args": ["--stdio"] } } }"#,
        )
        .unwrap();

        let status = register_claude_at(home.path(), &sidecar_bin())
            .await
            .expect("register_claude_at");
        assert_eq!(status, RegistrationStatus::Updated);

        let raw = std::fs::read_to_string(&path).unwrap();
        let parsed: JsonValue = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            parsed["mcpServers"]["drawcast"]["command"],
            json!("/opt/drawcast/drawcast-mcp"),
        );
    }

    #[tokio::test]
    async fn register_codex_creates_dir_and_file() {
        let home = tempdir().unwrap();
        let status = register_codex_at(home.path(), &sidecar_bin())
            .await
            .expect("register_codex_at");
        assert_eq!(status, RegistrationStatus::Added);

        let raw = std::fs::read_to_string(home.path().join(".codex/config.toml")).unwrap();
        assert!(raw.contains("[mcp_servers.drawcast]"), "toml: {raw}");
        assert!(raw.contains("/opt/drawcast/drawcast-mcp"));
        assert!(raw.contains("--stdio"));
    }

    #[tokio::test]
    async fn register_codex_is_idempotent() {
        let home = tempdir().unwrap();
        register_codex_at(home.path(), &sidecar_bin()).await.unwrap();
        let status = register_codex_at(home.path(), &sidecar_bin())
            .await
            .unwrap();
        assert_eq!(status, RegistrationStatus::AlreadyPresent);
    }
}
