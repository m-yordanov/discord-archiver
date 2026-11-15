use super::Reply;
use std::path::{Path, PathBuf};
use tauri::webview::PlatformWebview;
use webkit2gtk::{
    gio, glib, WebViewExt, WebsiteDataManagerExt, WebsiteDataManagerExtManual, WebsiteDataTypes,
};

pub type Webview = webkit2gtk::WebView;

pub fn webview(webview: PlatformWebview) -> Webview {
    webview.inner()
}

pub fn cache_dirs(webview: &Webview) -> Result<Vec<PathBuf>, String> {
    let root = webview
        .website_data_manager()
        .and_then(|manager| manager.base_cache_directory())
        .ok_or_else(|| "The webview has no cache folder.".to_string())?;
    Ok(vec![PathBuf::from(root.as_str()).join("WebKitCache")])
}

pub fn clear_disk_cache(webview: &Webview, reply: Reply<()>) {
    let Some(manager) = webview.website_data_manager() else {
        let _ = reply.send(Err("The webview has no data manager.".to_string()));
        return;
    };
    manager.clear(
        WebsiteDataTypes::DISK_CACHE | WebsiteDataTypes::MEMORY_CACHE,
        glib::TimeSpan(0),
        None::<&gio::Cancellable>,
        move |result| {
            let _ = reply.send(result.map_err(|e| e.to_string()));
        },
    );
}

pub fn open_folder(path: &Path) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
