use super::Reply;
use std::path::{Path, PathBuf};
use tauri::webview::PlatformWebview;

pub type Webview = ();

const UNSUPPORTED: &str = "Clearing the cache is only supported on Windows and Linux.";

pub fn webview(_: PlatformWebview) -> Webview {}

pub fn cache_dirs(_: &Webview) -> Result<Vec<PathBuf>, String> {
    Err(UNSUPPORTED.to_string())
}

pub fn clear_disk_cache(_: &Webview, reply: Reply<()>) {
    let _ = reply.send(Err(UNSUPPORTED.to_string()));
}

pub fn open_folder(_: &Path) -> Result<(), String> {
    Err(UNSUPPORTED.to_string())
}
