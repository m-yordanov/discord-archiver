mod archive;
mod cache;
mod media;
mod models;
mod content;
mod export;
mod parser;
mod search;
mod stats;
mod commands;
mod session;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(session::AppState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_data_package,
            commands::close_package,
            commands::get_messages,
            commands::get_raw_message,
            commands::search_channel_messages,
            commands::search_all_messages,
            commands::get_channel_media,
            commands::download_channel_media,
            commands::export_conversation,
            cache::get_cache_info,
            cache::clear_cache,
            cache::open_cache_folder,
            commands::get_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
