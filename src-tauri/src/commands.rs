use std::fs;
use std::io;
use std::time::Duration;
use crate::models::{
    ChannelMediaItem, DataIndex, DownloadResult, Message, MessagesResponse, SearchMatch,
    SearchResponse,
};
use crate::export::{self, ExportResult};
use crate::media::{is_audio, is_image, is_other_file, is_video};
use crate::parser;
use crate::search::GlobalSearchResponse;
use crate::session::{AppState, Session};
use crate::stats::{epoch_seconds, PackageStats};
use serde::Deserialize;
use tauri::{AppHandle, Manager};
use ureq::http::{header::LOCATION, Uri};

async fn run_blocking<T, F>(app: AppHandle, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&AppState) -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || task(app.state::<AppState>().inner()))
        .await
        .map_err(|e| e.to_string())?
}

async fn run_with_session<T, F>(app: AppHandle, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Session) -> Result<T, String> + Send + 'static,
{
    let session = app.state::<AppState>().session()?;
    tauri::async_runtime::spawn_blocking(move || task(&session))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn load_data_package(path: String, app: AppHandle) -> Result<DataIndex, String> {
    run_blocking(app, move |state| {
        let (session, index) = Session::open(&path)?;
        state.replace(Some(session))?;
        Ok(index)
    })
    .await
}

#[tauri::command]
pub async fn close_package(app: AppHandle) -> Result<(), String> {
    run_blocking(app, |state| state.replace(None)).await
}

#[tauri::command]
pub async fn get_messages(
    folder_names: Vec<String>,
    offset: Option<usize>,
    limit: Option<usize>,
    filter: Option<MessageFilter>,
    app: AppHandle,
) -> Result<MessagesResponse, String> {
    run_with_session(app, move |session| {
        session.with_channel_messages(&folder_names, |messages| {
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
    run_with_session(app, move |session| {
        session.search_all(
            &query,
            scope.as_deref().unwrap_or("all"),
            limit.unwrap_or(200),
        )
    })
    .await
}

#[tauri::command]
pub async fn get_raw_message(
    folder_names: Vec<String>,
    message_id: String,
    app: AppHandle,
) -> Result<String, String> {
    run_with_session(app, move |session| session.raw_message(&folder_names, &message_id)).await
}

#[tauri::command]
pub async fn get_stats(app: AppHandle) -> Result<PackageStats, String> {
    run_with_session(app, |session| Ok(session.stats().clone())).await
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
    offset: Option<usize>,
    limit: Option<usize>,
    app: AppHandle,
) -> Result<SearchResponse, String> {
    run_with_session(app, move |session| {
        session.with_channel_messages(&folder_names, |messages| {
            search_messages(messages, &query, &filter.unwrap_or_default(), offset, limit)
        })
    })
    .await
}

fn matches_query(msg: &Message, q: &str) -> bool {
    q.is_empty()
        || msg.contents.to_lowercase().contains(q)
        || msg.id.contains(q)
        || msg.attachments.iter().any(|a| a.to_lowercase().contains(q))
        || msg.embeds.iter().any(|e| {
            [e.title.as_deref(), e.description.as_deref(), e.provider_name.as_deref()]
                .into_iter()
                .flatten()
                .any(|f| f.to_lowercase().contains(q))
        })
}

fn search_messages(
    messages: &[Message],
    query: &str,
    filter: &MessageFilter,
    offset: Option<usize>,
    limit: Option<usize>,
) -> SearchResponse {
    let q = query.trim().to_lowercase();
    let hits: Vec<(usize, &Message)> = messages
        .iter()
        .filter(|m| filter.matches(m))
        .enumerate()
        .filter(|(_, msg)| matches_query(msg, &q))
        .collect();

    let total_matches = hits.len();
    let limit = limit.filter(|&l| l > 0).unwrap_or(total_matches);
    let start = offset
        .unwrap_or_else(|| total_matches.saturating_sub(limit))
        .min(total_matches);

    let matches = hits[start..]
        .iter()
        .take(limit)
        .map(|&(total_index, msg)| SearchMatch {
            message: msg.clone(),
            total_index,
        })
        .collect();

    SearchResponse {
        matches,
        total_matches,
        offset: start,
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
    run_with_session(app, move |session| {
        session.with_channel_messages(&folder_names, |messages| {
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
    run_with_session(app, move |session| {
        session.with_channel_messages(&folder_names, extract_media_items)
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

const MEDIA_HOST_DOMAINS: [&str; 3] = ["discordapp.com", "discordapp.net", "discord.com"];
const MEDIA_HOSTS: [&str; 1] = ["web.archive.org"];
const MAX_MEDIA_BYTES: u64 = 500 * 1024 * 1024;
const MAX_MEDIA_REDIRECTS: usize = 3;

fn media_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .https_only(true)
        .max_redirects(0)
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(30)))
        .timeout_global(Some(Duration::from_secs(300)))
        .build()
        .into()
}

fn is_allowed_media_uri(uri: &Uri) -> bool {
    let Some(host) = uri.host().map(str::to_ascii_lowercase) else {
        return false;
    };
    uri.scheme_str() == Some("https")
        && uri.port_u16().is_none_or(|port| port == 443)
        && (MEDIA_HOSTS.contains(&host.as_str())
            || MEDIA_HOST_DOMAINS.iter().any(|domain| {
                host.strip_suffix(domain)
                    .is_some_and(|sub| sub.len() > 1 && sub.ends_with('.'))
            }))
}

fn resolve_redirect(base: &Uri, location: &str) -> Option<Uri> {
    if location.starts_with('/') {
        format!("{}://{}{}", base.scheme_str()?, base.authority()?, location)
            .parse()
            .ok()
    } else {
        location.parse().ok()
    }
}

fn fetch_media(agent: &ureq::Agent, url: &str) -> Option<ureq::http::Response<ureq::Body>> {
    let mut uri: Uri = url.parse().ok()?;
    for _ in 0..=MAX_MEDIA_REDIRECTS {
        if !is_allowed_media_uri(&uri) {
            return None;
        }
        let response = agent.get(uri.clone()).call().ok()?;
        let status = response.status();
        if !status.is_redirection() {
            return status.is_success().then_some(response);
        }
        let location = response.headers().get(LOCATION)?.to_str().ok()?;
        uri = resolve_redirect(&uri, location)?;
    }
    None
}

#[tauri::command]
pub async fn download_channel_media(
    folder_names: Vec<String>,
    save_path: String,
    app: AppHandle,
) -> Result<DownloadResult, String> {
    run_with_session(app, move |session| {
        let media_items = session.with_channel_messages(&folder_names, extract_media_items)?;
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

    let agent = media_agent();
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

        let Some(mut response) = fetch_media(&agent, &item.url) else {
            continue;
        };
        let mut body = response
            .body_mut()
            .with_config()
            .limit(MAX_MEDIA_BYTES)
            .reader();

        if zip_writer.start_file(&entry_name, options).is_err() {
            continue;
        }
        if io::copy(&mut body, &mut zip_writer).is_ok() {
            downloaded_count += 1;
        } else {
            zip_writer
                .abort_file()
                .map_err(|e| format!("Could not write zip entry {}: {}", entry_name, e))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn message(id: &str, timestamp: &str, attachments: &[&str]) -> Message {
        Message {
            id: id.into(),
            timestamp: timestamp.into(),
            contents: "hi".into(),
            attachments: attachments.iter().map(|a| a.to_string()).collect(),
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

        let found = search_messages(&messages, "", &filter, Some(0), None);
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

        let unfiltered = search_messages(&messages, "", &MessageFilter::default(), Some(0), None);
        assert_eq!(unfiltered.matches[2].total_index, 2);
        assert_eq!(unfiltered.matches[2].message.id, "c");
    }

    #[test]
    fn search_pages_reach_every_match_and_start_at_the_newest() {
        let messages: Vec<Message> = (0..1200)
            .map(|i| {
                let mut msg = message(&format!("m{i}"), &format!("2023-01-01T00:00:{i:04}Z"), &[]);
                msg.contents = if i % 2 == 0 { "server".into() } else { "other".into() };
                msg
            })
            .collect();
        let filter = MessageFilter::default();

        let newest = search_messages(&messages, "SERVER", &filter, None, Some(250));
        assert_eq!(newest.total_matches, 600);
        assert_eq!(newest.offset, 350);
        assert_eq!(newest.matches.len(), 250);
        assert_eq!(newest.matches.last().unwrap().message.id, "m1198");
        assert_eq!(newest.matches.last().unwrap().total_index, 1198);

        let oldest = search_messages(&messages, "server", &filter, Some(0), Some(250));
        assert_eq!(oldest.offset, 0);
        assert_eq!(oldest.matches[0].message.id, "m0");

        let middle = search_messages(&messages, "server", &filter, Some(300), Some(250));
        assert_eq!(middle.matches[0].message.id, "m600");
        assert_eq!(middle.matches[0].total_index, 600);

        let past_end = search_messages(&messages, "server", &filter, Some(5000), Some(250));
        assert_eq!(past_end.offset, 600);
        assert!(past_end.matches.is_empty());

        let none = search_messages(&messages, "absent", &filter, None, Some(250));
        assert_eq!((none.total_matches, none.offset, none.matches.len()), (0, 0, 0));
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

    fn uri(value: &str) -> Uri {
        value.parse().unwrap()
    }

    #[test]
    fn media_downloads_are_limited_to_discord_and_archive_over_https() {
        assert!(is_allowed_media_uri(&uri("https://cdn.discordapp.com/attachments/1/2/a.png")));
        assert!(is_allowed_media_uri(&uri("https://media.discordapp.net/a.png?x=1")));
        assert!(is_allowed_media_uri(&uri("https://CDN.DiscordApp.com:443/a.png")));
        assert!(is_allowed_media_uri(&uri("https://web.archive.org/web/2020id_/a.png")));

        assert!(!is_allowed_media_uri(&uri("http://cdn.discordapp.com/a.png")));
        assert!(!is_allowed_media_uri(&uri("https://cdn.discordapp.com:8443/a.png")));
        assert!(!is_allowed_media_uri(&uri("https://discordapp.com/a.png")));
        assert!(!is_allowed_media_uri(&uri("https://evildiscordapp.com/a.png")));
        assert!(!is_allowed_media_uri(&uri("https://cdn.discordapp.com.evil.com/a.png")));
        assert!(!is_allowed_media_uri(&uri("https://127.0.0.1/a.png")));
        assert!(!is_allowed_media_uri(&uri("https://192.168.1.1/a.png")));
        assert!(!is_allowed_media_uri(&uri("/etc/passwd")));
    }

    #[test]
    fn redirects_resolve_against_the_current_host() {
        let base = uri("https://cdn.discordapp.com/attachments/a.png");
        assert_eq!(
            resolve_redirect(&base, "/other/b.png").unwrap(),
            uri("https://cdn.discordapp.com/other/b.png")
        );
        assert_eq!(
            resolve_redirect(&base, "//127.0.0.1/x").unwrap().host(),
            Some("cdn.discordapp.com")
        );
        let absolute = resolve_redirect(&base, "http://127.0.0.1/x").unwrap();
        assert!(!is_allowed_media_uri(&absolute));
    }

    #[test]
    fn media_zip_never_reads_local_files_or_private_hosts() {
        let dir = std::env::temp_dir().join("test_discord_archiver_media_zip");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let secret = dir.join("secret.txt");
        fs::write(&secret, b"private").unwrap();
        let zip_path = dir.join("media.zip");

        let item = |url: &str| ChannelMediaItem {
            url: url.into(),
            message_id: "1".into(),
            author: "You".into(),
            timestamp: "2023-01-01".into(),
            filename: "secret.txt".into(),
            media_type: "file".into(),
        };
        let items = vec![
            item(secret.to_str().unwrap()),
            item(&format!("file:///{}", secret.display())),
            item("http://127.0.0.1:1/secret.txt"),
            item("https://localhost:1/secret.txt"),
        ];

        let result = write_media_zip(&items, zip_path.to_string_lossy().to_string()).unwrap();
        assert_eq!(result.count, 0);
        let archive = zip::ZipArchive::new(fs::File::open(&zip_path).unwrap()).unwrap();
        assert_eq!(archive.len(), 0);
        let _ = fs::remove_dir_all(&dir);
    }
}


