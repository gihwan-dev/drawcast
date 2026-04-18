//! System-clipboard writers for the "Copy as PNG" and "Copy as Excalidraw"
//! toolbar actions introduced in PR #19.
//!
//! The MVP keeps the platform surface deliberately small:
//!
//! * [`write_png`] decodes the PNG bytes the frontend exported via
//!   Excalidraw's `exportToBlob`, converts them into the RGBA buffer
//!   `arboard` expects, and places that buffer on the system clipboard.
//!   Pasting the result in Preview / Keynote / Slack keeps the image,
//!   while pasting into Excalidraw web still works because Excalidraw
//!   grabs the raster clipboard item.
//!
//! * [`write_text`] writes a plain-text payload to the clipboard. That is
//!   enough for Excalidraw web *and* the Obsidian Excalidraw plugin to
//!   detect the `excalidraw/clipboard` envelope on paste — platform
//!   multi-MIME clipboards are deliberately deferred (see
//!   `docs/07-session-and-ipc.md` "Copy as Excalidraw").
//!
//! `arboard::Clipboard::new()` can fail on headless Linux CI (no X11 /
//! Wayland session). Both functions surface those initialisation errors
//! verbatim so the frontend can render a meaningful toast without the
//! user having to dig through panics.

use std::borrow::Cow;
use std::io::Cursor;

use anyhow::{Context, Result};
use arboard::{Clipboard, ImageData};
use image::ImageReader;

/// Decode `bytes` (an encoded PNG produced by the canvas) and place it on
/// the system clipboard as a raw RGBA image. Returns `Ok(())` on success.
///
/// Errors propagate from `image::ImageReader` (decode failure) and from
/// `arboard::Clipboard` (no clipboard available / write denied).
pub fn write_png(bytes: &[u8]) -> Result<()> {
    let cursor = Cursor::new(bytes);
    let img = ImageReader::new(cursor)
        .with_guessed_format()
        .context("guess PNG format")?
        .decode()
        .context("decode PNG bytes")?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let data = ImageData {
        width: width as usize,
        height: height as usize,
        bytes: Cow::Owned(rgba.into_raw()),
    };
    let mut clipboard = Clipboard::new().context("open system clipboard")?;
    clipboard
        .set_image(data)
        .context("write PNG image to clipboard")?;
    Ok(())
}

/// Place `text` on the system clipboard as `text/plain`. Excalidraw web
/// and Obsidian Excalidraw both sniff the JSON envelope on paste, so a
/// single flavor is sufficient for the MVP.
pub fn write_text(text: &str) -> Result<()> {
    let mut clipboard = Clipboard::new().context("open system clipboard")?;
    clipboard
        .set_text(text.to_string())
        .context("write text to clipboard")?;
    Ok(())
}
