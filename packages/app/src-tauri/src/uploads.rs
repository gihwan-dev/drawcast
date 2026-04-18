//! File upload destination helper.
//!
//! The three upload channels in PR #16 (drag-drop onto the left panel,
//! clipboard paste, paperclip file picker) all funnel into `save_upload`
//! via the `save_upload` Tauri command. This module owns:
//! - filename sanitization (strip path separators, control chars, clamp length),
//! - `uploads/` subdir creation under a session directory,
//! - suffix-based collision avoidance so repeated drops don't overwrite.
//!
//! The on-disk contract mirrors `docs/07-session-and-ipc.md`:
//! `~/.drawcast/sessions/{id}/uploads/<sanitized-name>`.
//!
//! PR #18 reuses the same sanitize + collision primitives for the snapshot
//! button via `save_preview_bytes`, which writes to a sibling `previews/`
//! subdirectory.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};

const UPLOADS_DIR: &str = "uploads";
const PREVIEWS_DIR: &str = "previews";
/// Cap on the sanitized filename. Long enough for realistic screenshot paths
/// like `Screen Shot 2026-04-18 at 22.31.47.png` (~46 chars) plus a stem +
/// extension buffer, but short enough to avoid blowing past filesystem path
/// limits when combined with the session path.
const MAX_FILENAME_LEN: usize = 120;

/// Save `data` under `session_path/uploads/<sanitized(filename)>`. If a file
/// with that name already exists, append `-1`, `-2`, … to the stem until a
/// free slot is found. Returns the absolute path the bytes were written to.
///
/// Fails on empty `filename` or a filename that contains a null byte —
/// those never come from a user-intended upload, so refusing them early
/// avoids silent rewrites.
pub fn save_upload(session_path: &Path, filename: &str, data: &[u8]) -> Result<PathBuf> {
    save_under(session_path, UPLOADS_DIR, filename, data)
}

/// Save `data` under `session_path/previews/<sanitized(filename)>`.
/// Mirrors [`save_upload`] for the explicit-snapshot button — the
/// sanitization, sub-directory creation, and collision-suffixing rules
/// are all identical, only the target directory differs. Returns the
/// absolute path the bytes were written to.
pub fn save_preview_bytes(
    session_path: &Path,
    filename: &str,
    data: &[u8],
) -> Result<PathBuf> {
    save_under(session_path, PREVIEWS_DIR, filename, data)
}

/// Shared implementation for the uploads/previews write paths.
fn save_under(
    session_path: &Path,
    subdir: &str,
    filename: &str,
    data: &[u8],
) -> Result<PathBuf> {
    if filename.is_empty() {
        return Err(anyhow!("filename must not be empty"));
    }
    if filename.contains('\0') {
        return Err(anyhow!("filename must not contain null bytes"));
    }

    let sanitized = sanitize_filename(filename);
    if sanitized.is_empty() {
        return Err(anyhow!(
            "filename sanitizes to empty string: {filename:?}"
        ));
    }

    let dir = session_path.join(subdir);
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("mkdir {}", dir.display()))?;

    let target = unique_path(&dir, &sanitized);
    std::fs::write(&target, data)
        .with_context(|| format!("write {}", target.display()))?;
    Ok(target)
}

/// Replace path separators, control characters, and the reserved
/// cross-platform set with `_`; collapse whitespace runs to a single `_`;
/// clamp to `MAX_FILENAME_LEN` characters. Non-ASCII letters (including
/// Hangul) are preserved — Claude Code handles them fine as `@`-refs.
pub fn sanitize_filename(name: &str) -> String {
    // Strip any directory components the OS might have smuggled in
    // (`../evil/foo.png` → `foo.png`). `Path::file_name` handles both
    // `/` and `\` on Unix/Windows normalization but we still run a
    // belt-and-suspenders replacement below for embedded separators
    // inside the name portion itself (Windows allows colons in some
    // forms, drag-drop payloads are pre-flattened on macOS, etc.).
    let base = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(name);

    let mut collapsed_ws = false;
    let mut out = String::with_capacity(base.len());
    for ch in base.chars() {
        let replaced = match ch {
            // Path separators — even though `file_name` stripped most,
            // guard against malformed input that slipped through.
            '/' | '\\' => '_',
            // Windows reserved metachars.
            '?' | '%' | '*' | ':' | '|' | '"' | '<' | '>' => '_',
            // Control characters (C0 + DEL).
            c if (c as u32) < 0x20 || c == '\u{7f}' => '_',
            c => c,
        };
        if replaced.is_whitespace() {
            if !collapsed_ws {
                out.push('_');
                collapsed_ws = true;
            }
            continue;
        }
        collapsed_ws = false;
        out.push(replaced);
    }

    // Trim leading dots so a name like `..` can't resolve to a parent
    // directory reference after path-join.
    let trimmed = out.trim_start_matches('.').trim_matches('_').to_string();

    // Clamp by char count (not byte count) so we don't split a multi-byte
    // codepoint mid-way.
    if trimmed.chars().count() > MAX_FILENAME_LEN {
        let mut clipped = String::with_capacity(MAX_FILENAME_LEN);
        for (idx, ch) in trimmed.chars().enumerate() {
            if idx >= MAX_FILENAME_LEN {
                break;
            }
            clipped.push(ch);
        }
        clipped
    } else {
        trimmed
    }
}

/// Given a target directory and a sanitized filename, produce a path that
/// doesn't already exist by appending `-1`, `-2`, etc. to the stem.
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }

    let (stem, ext) = split_stem_ext(name);
    for n in 1..u32::MAX {
        let suffixed = match ext {
            Some(e) => format!("{stem}-{n}.{e}"),
            None => format!("{stem}-{n}"),
        };
        let path = dir.join(&suffixed);
        if !path.exists() {
            return path;
        }
    }
    // Should be unreachable for any realistic uploads volume, but fall
    // back to the original candidate so we at least fail on write with
    // a meaningful error instead of looping forever.
    candidate
}

fn split_stem_ext(name: &str) -> (&str, Option<&str>) {
    match name.rfind('.') {
        // Treat a leading-dot "hidden" file (`.gitignore`) as all-stem, no ext.
        Some(idx) if idx > 0 => (&name[..idx], Some(&name[idx + 1..])),
        _ => (name, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn save_upload_writes_to_uploads_dir() {
        let dir = tempdir().unwrap();
        let out = save_upload(dir.path(), "hello.png", b"xyz").expect("save_upload");
        assert!(out.is_absolute(), "returned path should be absolute");
        assert!(out.ends_with("uploads/hello.png"), "got {}", out.display());
        assert_eq!(std::fs::read(&out).unwrap(), b"xyz");
        assert!(dir.path().join("uploads").is_dir());
    }

    #[test]
    fn save_upload_sanitizes_path_traversal_names() {
        let dir = tempdir().unwrap();
        let out = save_upload(dir.path(), "../evil/foo.png", b"data").expect("sanitize");
        let file_name = out.file_name().unwrap().to_string_lossy().into_owned();
        assert_eq!(file_name, "foo.png");
        // And the file actually lives under uploads/, not outside it.
        let parent = out.parent().unwrap();
        assert!(parent.ends_with("uploads"));
        assert_eq!(parent.parent().unwrap(), dir.path());
    }

    #[test]
    fn save_upload_suffixes_on_collision() {
        let dir = tempdir().unwrap();
        let first = save_upload(dir.path(), "pic.png", b"one").expect("first");
        let second = save_upload(dir.path(), "pic.png", b"two").expect("second");
        let third = save_upload(dir.path(), "pic.png", b"three").expect("third");

        assert_eq!(first.file_name().unwrap().to_string_lossy(), "pic.png");
        assert_eq!(second.file_name().unwrap().to_string_lossy(), "pic-1.png");
        assert_eq!(third.file_name().unwrap().to_string_lossy(), "pic-2.png");
        assert_eq!(std::fs::read(&first).unwrap(), b"one");
        assert_eq!(std::fs::read(&second).unwrap(), b"two");
        assert_eq!(std::fs::read(&third).unwrap(), b"three");
    }

    #[test]
    fn sanitize_replaces_control_chars_and_reserved_set() {
        // Backslash isn't a Unix path separator, so it stays in the basename
        // and our reserved-char pass rewrites it — alongside `:` and `*`.
        assert_eq!(sanitize_filename("name\\with:bad*chars.png"), "name_with_bad_chars.png");
        assert_eq!(sanitize_filename("x\u{7f}y"), "x_y");
        assert_eq!(sanitize_filename("   spaced  out  "), "spaced_out");
    }

    #[test]
    fn sanitize_clamps_to_max_length() {
        let long = "a".repeat(200);
        let sanitized = sanitize_filename(&long);
        assert_eq!(sanitized.chars().count(), MAX_FILENAME_LEN);
    }

    #[test]
    fn save_upload_rejects_empty_or_null_names() {
        let dir = tempdir().unwrap();
        assert!(save_upload(dir.path(), "", b"x").is_err());
        assert!(save_upload(dir.path(), "bad\0name.png", b"x").is_err());
    }

    #[test]
    fn save_preview_bytes_writes_to_previews_dir() {
        let dir = tempdir().unwrap();
        let out = save_preview_bytes(dir.path(), "snap-1.png", b"\x89PNG")
            .expect("save_preview_bytes");
        assert!(out.is_absolute(), "returned path should be absolute");
        assert!(
            out.ends_with("previews/snap-1.png"),
            "got {}",
            out.display()
        );
        assert_eq!(std::fs::read(&out).unwrap(), b"\x89PNG");
        assert!(dir.path().join("previews").is_dir());
        // uploads/ is untouched — the two channels live in separate dirs.
        assert!(!dir.path().join("uploads").is_dir());
    }

    #[test]
    fn save_preview_bytes_suffixes_on_collision() {
        let dir = tempdir().unwrap();
        let a = save_preview_bytes(dir.path(), "snap.png", b"one").unwrap();
        let b = save_preview_bytes(dir.path(), "snap.png", b"two").unwrap();
        assert_eq!(a.file_name().unwrap().to_string_lossy(), "snap.png");
        assert_eq!(b.file_name().unwrap().to_string_lossy(), "snap-1.png");
    }
}
