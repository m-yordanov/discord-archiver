use std::sync::Mutex;
use crate::archive::Source;
use crate::models::{DataIndex, Message, MessagesResponse, SearchMatch, SearchResponse};
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

fn is_image(url: &str) -> bool {
    let clean = url.split('?').next().unwrap_or(url).to_lowercase();
    clean.ends_with(".png")
        || clean.ends_with(".jpg")
        || clean.ends_with(".jpeg")
        || clean.ends_with(".gif")
        || clean.ends_with(".webp")
        || clean.ends_with(".bmp")
        || clean.ends_with(".svg")
}

fn is_video(url: &str) -> bool {
    let clean = url.split('?').next().unwrap_or(url).to_lowercase();
    clean.ends_with(".mp4")
        || clean.ends_with(".webm")
        || clean.ends_with(".mov")
        || clean.ends_with(".mkv")
}

fn is_other_file(url: &str) -> bool {
    !is_image(url) && !is_video(url)
}

fn matches_attachment(msg: &Message, mode: Option<&str>) -> bool {
    match mode {
        Some("has") => !msg.attachments.is_empty(),
        Some("none") => msg.attachments.is_empty(),
        Some("images") => msg.attachments.iter().any(|a| is_image(a)),
        Some("videos") => msg.attachments.iter().any(|a| is_video(a)),
        Some("files") => msg.attachments.iter().any(|a| is_other_file(a)),
        _ => true,
    }
}

fn matches_date(
    timestamp: &str,
    mode: Option<&str>,
    from: Option<&str>,
    to: Option<&str>,
) -> bool {
    let mode = mode.unwrap_or("any");
    if mode == "any" {
        return true;
    }

    let ts = timestamp.replace(' ', "T");
    let ts_prefix = if ts.len() >= 10 { &ts[..10] } else { &ts };

    match mode {
        "before" => {
            if let Some(f) = from {
                if !f.is_empty() {
                    return ts_prefix <= f;
                }
            }
            true
        }
        "after" => {
            if let Some(f) = from {
                if !f.is_empty() {
                    return ts_prefix >= f;
                }
            }
            true
        }
        "between" => {
            let ok_from = match from {
                Some(f) if !f.is_empty() => ts_prefix >= f,
                _ => true,
            };
            let ok_to = match to {
                Some(t) if !t.is_empty() => ts_prefix <= t,
                _ => true,
            };
            ok_from && ok_to
        }
        _ => true,
    }
}

#[tauri::command]
pub fn search_channel_messages(
    data_path: Option<String>,
    folder_names: Vec<String>,
    query: String,
    date_mode: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    attachment_mode: Option<String>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<SearchResponse, String> {
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

    let q = query.trim().to_lowercase();
    let d_mode = date_mode.as_deref();
    let d_from = date_from.as_deref();
    let d_to = date_to.as_deref();
    let a_mode = attachment_mode.as_deref();

    let mut matches = Vec::new();

    for (idx, msg) in cached.messages.iter().enumerate() {
        if !matches_attachment(msg, a_mode) {
            continue;
        }

        if !matches_date(&msg.timestamp, d_mode, d_from, d_to) {
            continue;
        }

        let is_query_match = if q.is_empty() {
            true
        } else {
            msg.contents.to_lowercase().contains(&q)
                || msg.id.contains(&q)
                || msg.attachments.iter().any(|a| a.to_lowercase().contains(&q))
                || msg.stickers.iter().any(|s| s.name.to_lowercase().contains(&q) || s.id.contains(&q))
                || msg.embeds.iter().any(|e| {
                    [e.title.as_deref(), e.description.as_deref(), e.provider_name.as_deref()]
                        .into_iter()
                        .flatten()
                        .any(|f| f.to_lowercase().contains(&q))
                })
        };

        if is_query_match {
            matches.push(SearchMatch {
                message: msg.clone(),
                total_index: idx,
            });
        }
    }

    let total_matches = matches.len();
    if let Some(lim) = limit {
        if lim > 0 && matches.len() > lim {
            matches.truncate(lim);
        }
    }

    Ok(SearchResponse {
        matches,
        total_matches,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_matches_date_logic() {
        assert!(matches_date("2023-05-15 12:00:00", Some("before"), Some("2023-05-16"), None));
        assert!(!matches_date("2023-05-17 12:00:00", Some("before"), Some("2023-05-16"), None));
        assert!(matches_date("2023-05-17 12:00:00", Some("after"), Some("2023-05-16"), None));
        assert!(!matches_date("2023-05-15 12:00:00", Some("after"), Some("2023-05-16"), None));
        assert!(matches_date("2023-05-16 12:00:00", Some("between"), Some("2023-05-10"), Some("2023-05-20")));
        assert!(!matches_date("2023-05-25 12:00:00", Some("between"), Some("2023-05-10"), Some("2023-05-20")));
    }

    #[test]
    fn test_matches_attachment_logic() {
        let msg_none = Message {
            id: "1".into(),
            timestamp: "2023-01-01".into(),
            contents: "hi".into(),
            attachments: vec![],
            stickers: vec![],
            embeds: vec![],
            call_info: None,
            message_type: "DEFAULT".into(),
            author: "user".into(),
            author_id: None,
            message_reference: None,
        };
        let msg_img = Message {
            attachments: vec!["photo.png".into()],
            ..msg_none.clone()
        };
        let msg_vid = Message {
            attachments: vec!["video.mp4".into()],
            ..msg_none.clone()
        };

        assert!(matches_attachment(&msg_none, Some("none")));
        assert!(!matches_attachment(&msg_img, Some("none")));
        assert!(matches_attachment(&msg_img, Some("has")));
        assert!(matches_attachment(&msg_img, Some("images")));
        assert!(!matches_attachment(&msg_img, Some("videos")));
        assert!(matches_attachment(&msg_vid, Some("videos")));
    }
}

