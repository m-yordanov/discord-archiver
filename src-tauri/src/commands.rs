use std::sync::Mutex;
use crate::archive::Source;
use crate::models::{DataIndex, Message, MessagesResponse};
use crate::parser;
use tauri::State;

pub struct CachedChannel {
    pub folder_names: Vec<String>,
    pub messages: Vec<Message>,
}

pub struct AppState {
    pub source: Mutex<Option<Source>>,
    pub channel_cache: Mutex<Option<CachedChannel>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            source: Mutex::new(None),
            channel_cache: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub fn load_data_package(path: String, state: State<'_, AppState>) -> Result<DataIndex, String> {
    let (index, source) = parser::parse_package_source(&path)?;
    {
        let mut guard = state.source.lock().map_err(|e| e.to_string())?;
        *guard = Some(source);
    }
    {
        let mut cache_guard = state.channel_cache.lock().map_err(|e| e.to_string())?;
        *cache_guard = None;
    }
    Ok(index)
}

#[tauri::command]
pub fn get_messages(
    data_path: Option<String>,
    folder_names: Vec<String>,
    page: Option<usize>,
    page_size: Option<usize>,
    offset: Option<usize>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<MessagesResponse, String> {
    let page_val = page.unwrap_or(0);
    let page_size_val = page_size.unwrap_or(0);

    let mut cache_guard = state.channel_cache.lock().map_err(|e| e.to_string())?;

    let is_cached = cache_guard
        .as_ref()
        .is_some_and(|c| c.folder_names == folder_names);

    if !is_cached {
        let (texts, default_user_id) = {
            let mut source_guard = state.source.lock().map_err(|e| e.to_string())?;
            if let Some(source) = source_guard.as_mut() {
                parser::read_channel_texts_from_source(source, &folder_names)
            } else if let Some(path) = &data_path {
                parser::read_channel_texts_from_path(path, &folder_names)?
            } else {
                return Err("No data package loaded.".to_string());
            }
        };

        let messages = parser::parse_channel_messages(&texts, default_user_id.as_ref());
        *cache_guard = Some(CachedChannel {
            folder_names: folder_names.clone(),
            messages,
        });
    }

    let cached = cache_guard.as_ref().unwrap();
    Ok(parser::slice_messages(
        &cached.messages,
        offset,
        limit,
        page_val,
        page_size_val,
    ))
}

#[tauri::command]
pub fn get_raw_message(
    data_path: Option<String>,
    folder_names: Vec<String>,
    message_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut guard = state.source.lock().map_err(|e| e.to_string())?;
    if let Some(source) = guard.as_mut() {
        parser::load_raw_message_from_source(source, &folder_names, &message_id)
    } else if let Some(path) = data_path {
        parser::load_raw_message(&path, &folder_names, &message_id)
    } else {
        Err("No data package loaded.".to_string())
    }
}
