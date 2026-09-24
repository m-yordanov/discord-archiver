mod archive;
mod models;
mod parser;
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    archive::remove_legacy_cache();

    tauri::Builder::default()
        .manage(commands::AppState::new())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_data_package,
            commands::get_messages,
            commands::get_raw_message,
            commands::search_channel_messages,
            commands::get_channel_media,
            commands::download_channel_media,
            commands::get_cache_info,
            commands::clear_cache,
            commands::open_cache_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
