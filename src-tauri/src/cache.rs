use crate::session::AppState;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::time::Duration;
use tauri::webview::PlatformWebview;
use tauri::{AppHandle, Manager};

type Reply<T> = Sender<Result<T, String>>;

#[cfg(windows)]
#[path = "cache/windows.rs"]
mod native;

#[cfg(target_os = "linux")]
#[path = "cache/linux.rs"]
mod native;

#[cfg(not(any(windows, target_os = "linux")))]
#[path = "cache/unsupported.rs"]
mod native;

#[derive(serde::Serialize)]
pub struct CacheInfo {
    pub path: String,
    pub size_bytes: u64,
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => dir_size(&entry.path()),
            Ok(kind) if kind.is_file() => entry.metadata().map_or(0, |m| m.len()),
            _ => 0,
        })
        .sum()
}

fn on_webview<T: Send + 'static>(
    app: &AppHandle,
    task: impl FnOnce(&native::Webview, Reply<T>) + Send + 'static,
) -> Result<T, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "The main window is not available.".to_string())?;
    let (reply, answer) = mpsc::channel();
    window
        .with_webview(move |webview: PlatformWebview| task(&native::webview(webview), reply))
        .map_err(|e| e.to_string())?;
    answer
        .recv_timeout(Duration::from_secs(60))
        .map_err(|_| "The webview did not respond in time.".to_string())?
}

fn cache_dirs(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    on_webview(app, |webview, reply| {
        let _ = reply.send(native::cache_dirs(webview));
    })
}

fn cache_info(dirs: &[PathBuf]) -> CacheInfo {
    CacheInfo {
        path: dirs
            .first()
            .map(|dir| dir.to_string_lossy().to_string())
            .unwrap_or_default(),
        size_bytes: dirs.iter().map(|dir| dir_size(dir)).sum(),
    }
}

async fn run_blocking<T: Send + 'static>(
    app: AppHandle,
    task: impl FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || task(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_cache_info(app: AppHandle) -> Result<CacheInfo, String> {
    run_blocking(app, |app| Ok(cache_info(&cache_dirs(app)?))).await
}

#[tauri::command]
pub async fn clear_cache(app: AppHandle) -> Result<CacheInfo, String> {
    run_blocking(app, |app| {
        on_webview(app, native::clear_disk_cache)?;
        if let Ok(session) = app.state::<AppState>().session() {
            session.clear_channel_cache();
        }
        Ok(cache_info(&cache_dirs(app)?))
    })
    .await
}

#[tauri::command]
pub async fn open_cache_folder(app: AppHandle) -> Result<(), String> {
    run_blocking(app, |app| {
        let dir = cache_dirs(app)?
            .into_iter()
            .next()
            .ok_or_else(|| "No cache folder is known for this platform.".to_string())?;
        let target = if dir.is_dir() {
            dir
        } else {
            dir.parent().map(Path::to_path_buf).unwrap_or(dir)
        };
        native::open_folder(&target)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_cover_nested_folders() {
        let root = std::env::temp_dir().join("discord-archiver-cache-size-test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("a/b")).unwrap();
        fs::write(root.join("one.bin"), [0u8; 5]).unwrap();
        fs::write(root.join("a/b/two.bin"), [0u8; 10]).unwrap();

        assert_eq!(dir_size(&root), 15);
        assert_eq!(dir_size(&root.join("missing")), 0);
        assert_eq!(cache_info(&[root.clone(), root.join("a")]).size_bytes, 25);
        let _ = fs::remove_dir_all(&root);
    }
}
