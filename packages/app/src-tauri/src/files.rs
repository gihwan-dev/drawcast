//! "Export to file" sink for the canvas toolbar.
//!
//! The frontend already picked a destination through the Tauri dialog
//! plugin's `save({ filters })` flow and serialized the scene with the
//! right `@drawcast/core` envelope (`serializeAsExcalidrawFile` for
//! `.excalidraw`, `serializeAsObsidianMarkdown` for `.excalidraw.md`).
//! This module just writes the bytes.
//!
//! A dedicated Tauri command keeps us from pulling in the full
//! `tauri-plugin-fs` surface just to write a single user-chosen file.
//! The same pattern is already used for `save_upload` / `save_preview_bytes`
//! in `uploads.rs`.
//!
//! Validation is minimal on purpose:
//! * path must not be empty,
//! * the parent directory must exist (the save dialog guarantees that,
//!   but we still check so a malformed command doesn't silently create
//!   one).

use std::path::Path;

use anyhow::{anyhow, Context, Result};

/// Write `data` to `path`. Fails if `path` is empty or its parent
/// directory does not exist.
pub fn write_file(path: &Path, data: &[u8]) -> Result<()> {
    if path.as_os_str().is_empty() {
        return Err(anyhow!("export path must not be empty"));
    }
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err(anyhow!(
                "parent directory does not exist: {}",
                parent.display()
            ));
        }
    }
    std::fs::write(path, data)
        .with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn write_file_creates_target_with_bytes() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("scene.excalidraw");
        write_file(&target, b"{\"type\":\"excalidraw\"}").expect("write_file");
        assert_eq!(
            std::fs::read(&target).unwrap(),
            b"{\"type\":\"excalidraw\"}".to_vec()
        );
    }

    #[test]
    fn write_file_rejects_missing_parent_dir() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("no-such-dir").join("scene.excalidraw");
        let err = write_file(&target, b"data").unwrap_err();
        let msg = format!("{err}");
        assert!(
            msg.contains("parent directory does not exist"),
            "expected parent-missing error, got {msg}"
        );
    }

    #[test]
    fn write_file_rejects_empty_path() {
        let err = write_file(Path::new(""), b"data").unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("must not be empty"), "got {msg}");
    }
}
