use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use crate::archive::Source;
use crate::models::{
    ChannelMediaItem, DataIndex, DownloadResult, Message, MessagesResponse, SearchMatch,
    SearchResponse,
};
use crate::export::{self, ExportResult};
use crate::media::{is_audio, is_image, is_other_file, is_video};
use crate::parser;
use crate::search::{self, GlobalSearchResponse, SearchChannel, SearchCorpus};
use crate::stats::{epoch_seconds, PackageStats};
use serde::Deserialize;
use tauri::{AppHandle, Manager};

pub struct CachedChannel {
    pub folder_names: Vec<String>,
    pub messages: Vec<Message>,
}

pub struct AppState {
    pub source: Mutex<Option<Source>>,
    pub channel_cache: Mutex<Option<CachedChannel>>,
    pub stats: Mutex<Option<PackageStats>>,
    pub search_channels: Mutex<Vec<SearchChannel>>,
    pub search_corpus: Mutex<Option<SearchCorpus>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            source: Mutex::new(None),
            channel_cache: Mutex::new(None),
            stats: Mutex::new(None),
            search_channels: Mutex::new(Vec::new()),
            search_corpus: Mutex::new(None),
        }
    }
}

async fn run_blocking<T, F>(app: AppHandle, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&AppState) -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || task(app.state::<AppState>().inner()))
        .await
        .map_err(|e| e.to_string())?
}

fn with_channel_messages<T>(
    state: &AppState,
    folder_names: &[String],
    read: impl FnOnce(&[Message]) -> T,
) -> Result<T, String> {
    let mut cache_guard = state.channel_cache.lock().map_err(|e| e.to_string())?;

    let is_cached = cache_guard
        .as_ref()
        .is_some_and(|c| c.folder_names == folder_names);

    if !is_cached {
        let (texts, default_user_id) = {
            let mut source_guard = state.source.lock().map_err(|e| e.to_string())?;
            let source = source_guard
                .as_mut()
                .ok_or_else(|| "No data package loaded.".to_string())?;
            parser::read_channel_texts_from_source(source, folder_names)
        };

        let messages = parser::parse_channel_messages(&texts, default_user_id.as_ref());
        *cache_guard = Some(CachedChannel {
            folder_names: folder_names.to_vec(),
            messages,
        });
    }

    Ok(read(&cache_guard.as_ref().unwrap().messages))
}

#[tauri::command]
pub async fn load_data_package(path: String, app: AppHandle) -> Result<DataIndex, String> {
    run_blocking(app, move |state| {
        let (index, source, package_stats) = parser::parse_package_source(&path)?;
        *state.source.lock().map_err(|e| e.to_string())? = Some(source);
        *state.channel_cache.lock().map_err(|e| e.to_string())? = None;
        *state.stats.lock().map_err(|e| e.to_string())? = Some(package_stats);
        *state.search_channels.lock().map_err(|e| e.to_string())? = search::channels_of(&index);
        *state.search_corpus.lock().map_err(|e| e.to_string())? = None;
        Ok(index)
    })
    .await
}

#[tauri::command]
pub async fn close_package(app: AppHandle) -> Result<(), String> {
    run_blocking(app, |state| {
        *state.source.lock().map_err(|e| e.to_string())? = None;
        *state.channel_cache.lock().map_err(|e| e.to_string())? = None;
        *state.stats.lock().map_err(|e| e.to_string())? = None;
        *state.search_channels.lock().map_err(|e| e.to_string())? = Vec::new();
        *state.search_corpus.lock().map_err(|e| e.to_string())? = None;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_messages(
    folder_names: Vec<String>,
    offset: Option<usize>,
    limit: Option<usize>,
    filter: Option<MessageFilter>,
    app: AppHandle,
) -> Result<MessagesResponse, String> {
    run_blocking(app, move |state| {
        with_channel_messages(state, &folder_names, |messages| {
            match filter.filter(MessageFilter::is_active) {
                Some(filter) => {
                    let matching: Vec<&Message> =
                        messages.iter().filter(|m| filter.matches(m)).collect();
                    parser::slice_messages(&matching, offset, limit, 0, 0)
                }
                None => parser::slice_messages(messages, offset, limit, 0, 0),
            }
        })
    })
    .await
}

#[tauri::command]
pub async fn search_all_messages(
    query: String,
    scope: Option<String>,
    limit: Option<usize>,
    app: AppHandle,
) -> Result<GlobalSearchResponse, String> {
    run_blocking(app, move |state| {
        let mut corpus = state.search_corpus.lock().map_err(|e| e.to_string())?;
        if corpus.is_none() {
            let channels = state.search_channels.lock().map_err(|e| e.to_string())?.clone();
            let mut source = state.source.lock().map_err(|e| e.to_string())?;
            let source = source
                .as_mut()
                .ok_or_else(|| "No data package loaded.".to_string())?;
            *corpus = Some(SearchCorpus::build(source, channels));
        }
        Ok(corpus.as_ref().unwrap().search(
            &query,
            scope.as_deref().unwrap_or("all"),
            limit.unwrap_or(200),
        ))
    })
    .await
}

#[tauri::command]
pub async fn get_raw_message(
    folder_names: Vec<String>,
    message_id: String,
    app: AppHandle,
) -> Result<String, String> {
    run_blocking(app, move |state| {
        let mut guard = state.source.lock().map_err(|e| e.to_string())?;
        let source = guard
            .as_mut()
            .ok_or_else(|| "No data package loaded.".to_string())?;
        parser::load_raw_message_from_source(source, &folder_names, &message_id)
    })
    .await
}

#[tauri::command]
pub async fn get_stats(app: AppHandle) -> Result<PackageStats, String> {
    run_blocking(app, |state| {
        state
            .stats
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or_else(|| "No data package loaded.".to_string())
    })
    .await
}

#[derive(Deserialize, Default)]
pub struct MessageFilter {
    since: Option<i64>,
    until: Option<i64>,
    attachment: Option<String>,
}

impl MessageFilter {
    fn is_active(&self) -> bool {
        self.since.is_some() || self.until.is_some() || self.attachment.is_some()
    }

    fn matches(&self, msg: &Message) -> bool {
        self.matches_date(&msg.timestamp) && self.matches_attachment(msg)
    }

    fn matches_date(&self, timestamp: &str) -> bool {
        if self.since.is_none() && self.until.is_none() {
            return true;
        }
        epoch_seconds(timestamp).is_some_and(|seconds| {
            self.since.is_none_or(|since| seconds >= since)
                && self.until.is_none_or(|until| seconds <= until)
        })
    }

    fn matches_attachment(&self, msg: &Message) -> bool {
        match self.attachment.as_deref() {
            Some("has") => !msg.attachments.is_empty(),
            Some("none") => msg.attachments.is_empty(),
            Some("images") => msg.attachments.iter().any(|a| is_image(a)),
            Some("videos") => msg.attachments.iter().any(|a| is_video(a)),
            Some("audio") => {
                msg.attachments.iter().any(|a| is_audio(a)) || msg.message_type == "VOICE_MESSAGE"
            }
            Some("files") => msg.attachments.iter().any(|a| is_other_file(a)),
            _ => true,
        }
    }
}

#[tauri::command]
pub async fn search_channel_messages(
    folder_names: Vec<String>,
    query: String,
    filter: Option<MessageFilter>,
    limit: Option<usize>,
    app: AppHandle,
) -> Result<SearchResponse, String> {
    run_blocking(app, move |state| {
        with_channel_messages(state, &folder_names, |messages| {
            search_messages(messages, &query, &filter.unwrap_or_default(), limit)
        })
    })
    .await
}

fn search_messages(
    messages: &[Message],
    query: &str,
    filter: &MessageFilter,
    limit: Option<usize>,
) -> SearchResponse {
    let q = query.trim().to_lowercase();
    let mut matches = Vec::new();

    for (idx, msg) in messages.iter().filter(|m| filter.matches(m)).enumerate() {
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

    SearchResponse {
        matches,
        total_matches,
    }
}

pub fn extract_media_items(messages: &[Message]) -> Vec<ChannelMediaItem> {
    let mut items = Vec::new();
    for msg in messages {
        for url in &msg.attachments {
            let filename = url
                .split('?')
                .next()
                .unwrap_or(url)
                .split('/')
                .next_back()
                .unwrap_or("file")
                .to_string();

            let media_type = if is_image(url) {
                "image"
            } else if is_video(url) {
                "video"
            } else if is_audio(url) || msg.message_type == "VOICE_MESSAGE" {
                "audio"
            } else {
                "file"
            }
            .to_string();

            items.push(ChannelMediaItem {
                url: url.clone(),
                message_id: msg.id.clone(),
                author: msg.author.clone(),
                timestamp: msg.timestamp.clone(),
                filename,
                media_type,
            });
        }
    }
    items
}

#[tauri::command]
pub async fn export_conversation(
    folder_names: Vec<String>,
    format: String,
    title: String,
    save_path: String,
    app: AppHandle,
) -> Result<ExportResult, String> {
    run_blocking(app, move |state| {
        with_channel_messages(state, &folder_names, |messages| {
            export::write_export(messages, &format, &title, &save_path)
        })?
    })
    .await
}

#[tauri::command]
pub async fn get_channel_media(
    folder_names: Vec<String>,
    app: AppHandle,
) -> Result<Vec<ChannelMediaItem>, String> {
    run_blocking(app, move |state| {
        with_channel_messages(state, &folder_names, extract_media_items)
    })
    .await
}

fn sanitize_filename(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect();
    if sanitized.trim().is_empty() {
        "file".to_string()
    } else {
        sanitized
    }
}

#[tauri::command]
pub async fn download_channel_media(
    folder_names: Vec<String>,
    save_path: String,
    app: AppHandle,
) -> Result<DownloadResult, String> {
    run_blocking(app, move |state| {
        let media_items = with_channel_messages(state, &folder_names, extract_media_items)?;
        write_media_zip(&media_items, save_path)
    })
    .await
}

fn write_media_zip(
    media_items: &[ChannelMediaItem],
    save_path: String,
) -> Result<DownloadResult, String> {
    if media_items.is_empty() {
        return Ok(DownloadResult {
            success: true,
            count: 0,
            file_path: save_path,
            total_bytes: 0,
        });
    }

    let file = fs::File::create(&save_path)
        .map_err(|e| format!("Could not create zip file at {}: {}", save_path, e))?;
    let mut zip_writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut downloaded_count = 0;
    let mut seen_names: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (idx, item) in media_items.iter().enumerate() {
        let clean_name = sanitize_filename(&item.filename);
        let mut entry_name = format!("{:03}_{}", idx + 1, clean_name);
        let mut counter = 1;
        while seen_names.contains(&entry_name) {
            entry_name = format!("{:03}_{}_{}", idx + 1, counter, clean_name);
            counter += 1;
        }
        seen_names.insert(entry_name.clone());

        let bytes: Option<Vec<u8>> = if item.url.starts_with("http://") || item.url.starts_with("https://") {
            let res = ureq::get(&item.url).call();
            match res {
                Ok(mut r) => {
                    let mut buf = Vec::new();
                    use std::io::Read;
                    if r.body_mut().as_reader().read_to_end(&mut buf).is_ok() {
                        Some(buf)
                    } else {
                        None
                    }
                }
                Err(_) => None,
            }
        } else {
            fs::read(&item.url).ok()
        };

        if let Some(data) = bytes {
            use std::io::Write;
            if zip_writer.start_file(&entry_name, options).is_ok()
                && zip_writer.write_all(&data).is_ok()
            {
                    downloaded_count += 1;
                }
        }
    }

    zip_writer.finish().map_err(|e| format!("Could not finalize zip: {}", e))?;

    let total_bytes = fs::metadata(&save_path).map(|m| m.len()).unwrap_or(0);

    Ok(DownloadResult {
        success: true,
        count: downloaded_count,
        file_path: save_path,
        total_bytes,
    })
}

#[derive(serde::Serialize)]
pub struct CacheInfo {
    pub path: String,
    pub size_bytes: u64,
}

pub fn calculate_dir_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += calculate_dir_size(&p);
            } else if let Ok(meta) = p.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

pub fn delete_dir_contents_safe(dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                delete_dir_contents_safe(&path);
                let _ = fs::remove_dir(&path);
            } else {
                let _ = fs::remove_file(&path);
            }
        }
    }
}

pub fn resolve_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    if !cache_dir.exists() {
        let _ = fs::create_dir_all(&cache_dir);
    }
    Ok(cache_dir)
}

fn cache_info(dir: &Path) -> CacheInfo {
    CacheInfo {
        path: dir.to_string_lossy().to_string(),
        size_bytes: calculate_dir_size(dir),
    }
}

#[tauri::command]
pub async fn get_cache_info(app: AppHandle) -> Result<CacheInfo, String> {
    let dir = resolve_cache_dir(&app)?;
    run_blocking(app, move |_| Ok(cache_info(&dir))).await
}

#[tauri::command]
pub async fn clear_cache(app: AppHandle) -> Result<CacheInfo, String> {
    let dir = resolve_cache_dir(&app)?;
    run_blocking(app, move |state| {
        delete_dir_contents_safe(&dir);
        crate::archive::remove_legacy_cache();
        if let Ok(mut cache_guard) = state.channel_cache.lock() {
            *cache_guard = None;
        }
        Ok(cache_info(&dir))
    })
    .await
}

#[tauri::command]
pub fn open_cache_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = resolve_cache_dir(&app)?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(id: &str, timestamp: &str, attachments: &[&str]) -> Message {
        Message {
            id: id.into(),
            timestamp: timestamp.into(),
            contents: "hi".into(),
            attachments: attachments.iter().map(|a| a.to_string()).collect(),
            stickers: vec![],
            embeds: vec![],
            call_info: None,
            message_type: "DEFAULT".into(),
            author: "user".into(),
            author_id: None,
            message_reference: None,
        }
    }

    fn attachment_filter(mode: &str) -> MessageFilter {
        MessageFilter {
            attachment: Some(mode.into()),
            ..Default::default()
        }
    }

    #[test]
    fn date_bounds_are_inclusive_instants() {
        let since = epoch_seconds("2023-05-15T22:00:00Z");
        let until = epoch_seconds("2023-05-16T21:59:59Z");
        let filter = MessageFilter { since, until, attachment: None };

        assert!(filter.matches_date("2023-05-15T22:00:00.000+00:00"));
        assert!(filter.matches_date("2023-05-16T00:30:00.000+02:00"));
        assert!(filter.matches_date("2023-05-16 21:59:59"));
        assert!(!filter.matches_date("2023-05-15T21:59:59.000+00:00"));
        assert!(!filter.matches_date("2023-05-16T22:00:00.000+00:00"));
        assert!(!filter.matches_date("not a timestamp"));
        assert!(MessageFilter::default().matches_date("not a timestamp"));
    }

    #[test]
    fn test_matches_attachment_logic() {
        let msg_none = message("1", "2023-01-01", &[]);
        let msg_img = message("2", "2023-01-01", &["photo.png"]);
        let msg_vid = message("3", "2023-01-01", &["video.mp4"]);
        let msg_audio = message("4", "2023-01-01", &["voice-message.ogg"]);

        assert!(attachment_filter("none").matches(&msg_none));
        assert!(!attachment_filter("none").matches(&msg_img));
        assert!(attachment_filter("has").matches(&msg_img));
        assert!(attachment_filter("images").matches(&msg_img));
        assert!(!attachment_filter("videos").matches(&msg_img));
        assert!(attachment_filter("videos").matches(&msg_vid));
        assert!(!attachment_filter("audio").matches(&msg_img));
        assert!(attachment_filter("audio").matches(&msg_audio));
    }

    #[test]
    fn filtered_search_positions_match_the_filtered_pages() {
        let messages = vec![
            message("a", "2023-01-01T10:00:00Z", &["one.png"]),
            message("b", "2023-01-02T10:00:00Z", &[]),
            message("c", "2023-01-03T10:00:00Z", &["two.png"]),
            message("d", "2023-01-04T10:00:00Z", &[]),
            message("e", "2023-01-05T10:00:00Z", &["three.png"]),
        ];
        let filter = attachment_filter("images");

        let found = search_messages(&messages, "", &filter, None);
        let positions: Vec<(&str, usize)> = found
            .matches
            .iter()
            .map(|m| (m.message.id.as_str(), m.total_index))
            .collect();
        assert_eq!(positions, vec![("a", 0), ("c", 1), ("e", 2)]);

        let matching: Vec<&Message> = messages.iter().filter(|m| filter.matches(m)).collect();
        let page = parser::slice_messages(&matching, Some(1), Some(1), 0, 0);
        assert_eq!(page.total, 3);
        assert_eq!(page.messages[0].id, "c");

        let unfiltered = search_messages(&messages, "", &MessageFilter::default(), None);
        assert_eq!(unfiltered.matches[2].total_index, 2);
        assert_eq!(unfiltered.matches[2].message.id, "c");
    }

    #[test]
    fn test_extract_media_items() {
        let msg = Message {
            id: "m1".into(),
            timestamp: "2023-01-01".into(),
            contents: "test".into(),
            attachments: vec![
                "https://cdn.example.com/cat.png".into(),
                "https://cdn.example.com/sound.mp3".into(),
                "https://cdn.example.com/doc.pdf".into(),
            ],
            stickers: vec![],
            embeds: vec![],
            call_info: None,
            message_type: "DEFAULT".into(),
            author: "alice".into(),
            author_id: None,
            message_reference: None,
        };

        let items = extract_media_items(&[msg]);
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].media_type, "image");
        assert_eq!(items[0].filename, "cat.png");
        assert_eq!(items[1].media_type, "audio");
        assert_eq!(items[1].filename, "sound.mp3");
        assert_eq!(items[2].media_type, "file");
        assert_eq!(items[2].filename, "doc.pdf");
    }

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("valid.png"), "valid.png");
        assert_eq!(sanitize_filename("bad/name:here?.jpg"), "bad_name_here_.jpg");
    }

    #[test]
    fn test_calculate_dir_size_and_delete() {
        let temp = std::env::temp_dir().join("test_discord_archiver_cache_test_dir");
        let _ = fs::remove_dir_all(&temp);
        fs::create_dir_all(&temp).unwrap();
        let sub = temp.join("sub");
        fs::create_dir_all(&sub).unwrap();
        fs::write(temp.join("a.txt"), b"12345").unwrap();
        fs::write(sub.join("b.txt"), b"1234567890").unwrap();

        assert_eq!(calculate_dir_size(&temp), 15);
        delete_dir_contents_safe(&temp);
        assert_eq!(calculate_dir_size(&temp), 0);
        let _ = fs::remove_dir_all(&temp);
    }
}


