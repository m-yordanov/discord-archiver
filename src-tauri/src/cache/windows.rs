use super::Reply;
use std::path::{Path, PathBuf};
use tauri::webview::PlatformWebview;
use webview2_com::ClearBrowsingDataCompletedHandler;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Controller, ICoreWebView2Profile, ICoreWebView2Profile2, ICoreWebView2_13,
    COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
};
use windows_core::{Interface, PWSTR};

pub type Webview = ICoreWebView2Controller;

const CACHE_FOLDERS: [&str; 3] = ["Cache", "Code Cache", "GPUCache"];

pub fn webview(webview: PlatformWebview) -> Webview {
    webview.controller()
}

fn profile(controller: &Webview) -> windows_core::Result<ICoreWebView2Profile> {
    unsafe { controller.CoreWebView2()?.cast::<ICoreWebView2_13>()?.Profile() }
}

pub fn cache_dirs(controller: &Webview) -> Result<Vec<PathBuf>, String> {
    let profile = profile(controller).map_err(|e| e.to_string())?;
    let mut path = PWSTR::null();
    unsafe { profile.ProfilePath(&mut path) }.map_err(|e| e.to_string())?;
    let root = PathBuf::from(webview2_com::take_pwstr(path));
    Ok(CACHE_FOLDERS.iter().map(|folder| root.join(folder)).collect())
}

pub fn clear_disk_cache(controller: &Webview, reply: Reply<()>) {
    let on_done = reply.clone();
    let handler = ClearBrowsingDataCompletedHandler::create(Box::new(move |result| {
        let _ = on_done.send(result.map_err(|e| e.to_string()));
        Ok(())
    }));
    let started = profile(controller)
        .and_then(|profile| profile.cast::<ICoreWebView2Profile2>())
        .and_then(|profile| unsafe {
            profile.ClearBrowsingData(COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE, &handler)
        });
    if let Err(e) = started {
        let _ = reply.send(Err(e.to_string()));
    }
}

pub fn open_folder(path: &Path) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
