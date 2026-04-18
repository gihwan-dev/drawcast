//! Session directory manager.
//!
//! Owns the on-disk layout under `~/.drawcast/sessions/{id}/` and the
//! `.drawcast.json` metadata file. PR #15 expands the PR #12 stub to cover
//! create / list / switch flows; the on-disk shape matches the
//! `docs/07-session-and-ipc.md` spec.
//!
//! Every session directory contains:
//! - `.drawcast.json`      — session metadata (id, name, timestamps, ...)
//! - `uploads/`            — user-supplied files, referenced by CLI via @-file
//! - `previews/`           — app-generated PNG snapshots
//! - `scene.excalidraw`    — live scene snapshot (written by mcp-server)
//!
//! The module exposes both convenience wrappers (that read `$HOME`) and
//! explicit `*_at(home: &Path)` variants for tests — mirrors the pattern from
//! `cli_register.rs`.
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

/// On-disk session metadata. `camelCase` on the wire so the TS side can
/// deserialize without a manual mapping step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub cli_choice: Option<String>,
    pub theme: String,
    pub last_known_port: Option<u16>,
}

const META_FILE: &str = ".drawcast.json";
const UPLOADS_DIR: &str = "uploads";
const PREVIEWS_DIR: &str = "previews";
const DEFAULT_SESSION_ID: &str = "default";
const DEFAULT_THEME: &str = "sketchy";

/// `$HOME/.drawcast/sessions/`. Resolved from $HOME — used by callers that
/// want to surface the path (e.g. a "show in Finder" action). The commands
/// in this PR go through `session_path_for` / `default_session_path`
/// instead, so allow-dead-code for now.
#[allow(dead_code)]
pub fn sessions_root() -> Result<PathBuf> {
    let home = dirs_home()?;
    Ok(sessions_root_at(&home))
}

/// Testable variant — lets callers stub the home directory.
pub fn sessions_root_at(home: &Path) -> PathBuf {
    home.join(".drawcast").join("sessions")
}

/// `$HOME/.drawcast/sessions/default`. Created (with a fresh metadata file)
/// if missing. Kept for backwards compatibility with PR #12 callers that
/// don't know about named sessions yet.
pub fn default_session_path() -> Result<PathBuf> {
    let home = dirs_home()?;
    default_session_path_at(&home)
}

pub fn default_session_path_at(home: &Path) -> Result<PathBuf> {
    let root = sessions_root_at(home);
    let path = root.join(DEFAULT_SESSION_ID);
    ensure_session_layout(&path, "Default")?;
    Ok(path)
}

/// Resolve the directory for an existing session id. Does not verify the dir
/// exists — callers can layer their own checks.
pub fn session_path_for(id: &str) -> Result<PathBuf> {
    let home = dirs_home()?;
    Ok(session_path_for_at(&home, id))
}

pub fn session_path_for_at(home: &Path, id: &str) -> PathBuf {
    sessions_root_at(home).join(id)
}

/// Create a brand-new session with a fresh nanoid. Writes metadata + makes
/// the `uploads/` and `previews/` subdirs. Returns the meta so callers can
/// round-trip to the frontend without re-reading the file.
pub fn create_session(name: &str) -> Result<SessionMeta> {
    let home = dirs_home()?;
    create_session_at(&home, name)
}

pub fn create_session_at(home: &Path, name: &str) -> Result<SessionMeta> {
    let id = generate_session_id();
    let path = session_path_for_at(home, &id);
    create_session_dirs(&path)?;

    let now = now_millis();
    let meta = SessionMeta {
        id,
        name: name.trim().to_string(),
        created_at: now,
        updated_at: now,
        cli_choice: None,
        theme: DEFAULT_THEME.to_string(),
        last_known_port: None,
    };
    save_meta(&path, &meta)?;
    Ok(meta)
}

/// List every session under `$HOME/.drawcast/sessions/`. Directories without
/// a `.drawcast.json` (foreign subdirs, partial writes) are skipped rather
/// than failing the entire listing.
pub fn list_sessions() -> Result<Vec<SessionMeta>> {
    let home = dirs_home()?;
    list_sessions_at(&home)
}

pub fn list_sessions_at(home: &Path) -> Result<Vec<SessionMeta>> {
    let root = sessions_root_at(home);
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut out: Vec<SessionMeta> = Vec::new();
    let entries = std::fs::read_dir(&root)
        .with_context(|| format!("read dir {}", root.display()))?;
    for entry in entries {
        let entry = entry.with_context(|| format!("read entry in {}", root.display()))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let meta_path = path.join(META_FILE);
        if !meta_path.is_file() {
            continue;
        }
        match load_meta(&path) {
            Ok(meta) => out.push(meta),
            Err(err) => {
                // Corrupt meta — ignore it so one bad session doesn't poison
                // the whole list. Users can clean up manually.
                eprintln!(
                    "[drawcast] skipping session {}: {err:#}",
                    path.display()
                );
            }
        }
    }
    // Sort newest-first by updated_at so the dropdown's first item is the most
    // recently touched session.
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

/// Read `.drawcast.json` from a session directory.
pub fn load_meta(session_path: &Path) -> Result<SessionMeta> {
    let meta_path = session_path.join(META_FILE);
    let raw = std::fs::read_to_string(&meta_path)
        .with_context(|| format!("read {}", meta_path.display()))?;
    let meta: SessionMeta = serde_json::from_str(&raw)
        .with_context(|| format!("parse {}", meta_path.display()))?;
    Ok(meta)
}

/// Atomically persist metadata. Bumps `updated_at` so callers don't have to
/// remember. Writes to a temp file next to the target and renames.
pub fn save_meta(session_path: &Path, meta: &SessionMeta) -> Result<()> {
    std::fs::create_dir_all(session_path)
        .with_context(|| format!("mkdir {}", session_path.display()))?;

    let mut stamped = meta.clone();
    stamped.updated_at = now_millis();

    let target = session_path.join(META_FILE);
    let serialized = format!(
        "{}\n",
        serde_json::to_string_pretty(&stamped)
            .with_context(|| format!("serialize meta for {}", target.display()))?
    );

    let tmp = {
        let mut name = target
            .file_name()
            .ok_or_else(|| anyhow!("path has no file name: {}", target.display()))?
            .to_owned();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        name.push(format!(".{}.{nonce}.tmp", std::process::id()));
        target.with_file_name(name)
    };

    std::fs::write(&tmp, serialized.as_bytes())
        .with_context(|| format!("write tmp {}", tmp.display()))?;
    match std::fs::rename(&tmp, &target) {
        Ok(()) => Ok(()),
        Err(err) => {
            let _ = std::fs::remove_file(&tmp);
            Err(err).with_context(|| format!("rename tmp -> {}", target.display()))
        }
    }
}

fn create_session_dirs(path: &Path) -> Result<()> {
    std::fs::create_dir_all(path.join(UPLOADS_DIR))
        .with_context(|| format!("mkdir {}", path.join(UPLOADS_DIR).display()))?;
    std::fs::create_dir_all(path.join(PREVIEWS_DIR))
        .with_context(|| format!("mkdir {}", path.join(PREVIEWS_DIR).display()))?;
    Ok(())
}

/// Ensure a session dir + default metadata exists at `path`. Used by the
/// `default` session bootstrap so first-launch callers see a valid meta file.
fn ensure_session_layout(path: &Path, display_name: &str) -> Result<()> {
    create_session_dirs(path)?;
    let meta_path = path.join(META_FILE);
    if !meta_path.is_file() {
        let now = now_millis();
        let id = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(DEFAULT_SESSION_ID)
            .to_string();
        let meta = SessionMeta {
            id,
            name: display_name.to_string(),
            created_at: now,
            updated_at: now,
            cli_choice: None,
            theme: DEFAULT_THEME.to_string(),
            last_known_port: None,
        };
        save_meta(path, &meta)?;
    }
    Ok(())
}

fn generate_session_id() -> String {
    // 12 chars of URL-safe nanoid — plenty for local-only uniqueness and
    // short enough to look tidy in directory listings.
    const ALPHABET: [char; 36] = [
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
        'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    ];
    nanoid::nanoid!(12, &ALPHABET)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn dirs_home() -> Result<PathBuf> {
    // Keep the existing env-var fallback for parity with PR #12 callers that
    // may run in sandboxes where `dirs` returns None.
    if let Some(h) = dirs::home_dir() {
        return Ok(h);
    }
    if let Some(h) = std::env::var_os("HOME") {
        return Ok(PathBuf::from(h));
    }
    if let Some(h) = std::env::var_os("USERPROFILE") {
        return Ok(PathBuf::from(h));
    }
    Err(anyhow!("unable to resolve home directory: HOME/USERPROFILE unset"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn create_session_writes_meta_and_subdirs() {
        let home = tempdir().unwrap();
        let meta = create_session_at(home.path(), "foo").expect("create_session_at");

        assert!(!meta.id.is_empty(), "session id should be non-empty");
        assert_eq!(meta.name, "foo");
        assert_eq!(meta.theme, "sketchy");
        assert!(meta.cli_choice.is_none());
        assert!(meta.last_known_port.is_none());
        assert!(meta.created_at > 0);
        assert_eq!(meta.created_at, meta.updated_at);

        let session_path = session_path_for_at(home.path(), &meta.id);
        assert!(session_path.is_dir(), "session dir should exist");
        assert!(
            session_path.join(".drawcast.json").is_file(),
            ".drawcast.json should exist"
        );
        assert!(
            session_path.join("uploads").is_dir(),
            "uploads/ should exist"
        );
        assert!(
            session_path.join("previews").is_dir(),
            "previews/ should exist"
        );
    }

    #[test]
    fn list_sessions_includes_default_and_created() {
        let home = tempdir().unwrap();
        let _default = default_session_path_at(home.path()).expect("default");
        let created = create_session_at(home.path(), "alpha").expect("create alpha");

        let sessions = list_sessions_at(home.path()).expect("list");
        let ids: Vec<&str> = sessions.iter().map(|s| s.id.as_str()).collect();
        assert!(ids.contains(&"default"), "list contains default: {ids:?}");
        assert!(
            ids.contains(&created.id.as_str()),
            "list contains created: {ids:?}",
        );
        assert_eq!(
            sessions.len(),
            2,
            "exactly two sessions should be present, got {sessions:?}",
        );
    }

    #[test]
    fn save_meta_round_trips_through_load_meta() {
        let home = tempdir().unwrap();
        let path = home.path().join("sess");
        std::fs::create_dir_all(&path).unwrap();

        let meta = SessionMeta {
            id: "abc".to_string(),
            name: "round trip".to_string(),
            created_at: 1_000_000,
            updated_at: 1_000_000,
            cli_choice: Some("claude-code".to_string()),
            theme: "clean".to_string(),
            last_known_port: Some(43017),
        };
        save_meta(&path, &meta).expect("save_meta");

        let loaded = load_meta(&path).expect("load_meta");
        assert_eq!(loaded.id, "abc");
        assert_eq!(loaded.name, "round trip");
        assert_eq!(loaded.cli_choice.as_deref(), Some("claude-code"));
        assert_eq!(loaded.theme, "clean");
        assert_eq!(loaded.last_known_port, Some(43017));
        // updated_at is bumped on every save so expect the written value to
        // be >= original.
        assert!(
            loaded.updated_at >= meta.updated_at,
            "updated_at should be bumped on save"
        );
    }

    #[test]
    fn sessions_root_at_does_not_touch_disk() {
        let home = tempdir().unwrap();
        let root = sessions_root_at(home.path());
        assert_eq!(
            root,
            home.path().join(".drawcast").join("sessions")
        );
        assert!(
            !root.exists(),
            "pure path join must not create directories"
        );
    }
}
