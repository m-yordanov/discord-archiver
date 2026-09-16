use crate::models::{DataIndex, MessagesResponse};
use crate::parser;

#[tauri::command]
pub fn load_data_package(path: String) -> Result<DataIndex, String> {
    parser::parse_data_package(&path)
}

#[tauri::command]
pub fn get_messages(data_path: String, folder_names: Vec<String>, page: usize, page_size: usize) -> Result<MessagesResponse, String> {
    parser::load_messages(&data_path, &folder_names, page, page_size)
}

#[tauri::command]
pub fn get_raw_message(data_path: String, folder_names: Vec<String>, message_id: String) -> Result<String, String> {
    parser::load_raw_message(&data_path, &folder_names, &message_id)
}
