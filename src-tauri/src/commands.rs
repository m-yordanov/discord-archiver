use crate::models::{DataIndex, MessagesResponse};
use crate::parser;
use crate::stats::{self, PackageStats};

#[tauri::command]
pub fn load_data_package(path: String) -> Result<DataIndex, String> {
    parser::parse_data_package(&path)
}

#[tauri::command]
pub fn get_messages(data_path: String, folder_name: String, page: usize, page_size: usize) -> Result<MessagesResponse, String> {
    parser::load_messages(&data_path, &folder_name, page, page_size)
}

#[tauri::command]
pub fn get_raw_message(data_path: String, folder_name: String, message_id: String) -> Result<String, String> {
    parser::load_raw_message(&data_path, &folder_name, &message_id)
}

#[tauri::command]
pub fn get_stats(path: String) -> Result<PackageStats, String> {
    stats::compute_stats(&path)
}
