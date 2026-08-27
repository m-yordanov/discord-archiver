use crate::archive;
use crate::models::*;
use std::collections::{HashMap, HashSet};

const GUILD_CHANNEL_TYPES: [&str; 4] = [
    "GUILD_TEXT",
    "GUILD_VOICE",
    "GUILD_ANNOUNCEMENT",
    "GUILD_FORUM",
];

struct Package {
    source: archive::Source,
}

impl Package {
    fn open(path: &str) -> Result<Self, String> {
        Ok(Package {
            source: archive::Source::open(path)?,
        })
    }

    fn parse_index(text: Option<String>) -> HashMap<String, String> {
        text.and_then(|s| serde_json::from_str::<HashMap<String, serde_json::Value>>(&s).ok())
            .map(|m| {
                m.into_iter()
                    .filter_map(|(k, v)| match v {
                        serde_json::Value::String(s) => Some((k, s)),
                        _ => None,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn account(&mut self) -> Option<RawUserAccount> {
        self.source
            .read_root(&["account", "Account", "ACCOUNT", ""], "user.json")
            .and_then(|s| serde_json::from_str::<RawUserAccount>(&s).ok())
            .filter(|u| !u.id_string().is_empty())
    }
}

fn sticker_url(id: &str, format_type: Option<u64>) -> String {
    let ext = if format_type == Some(4) { "gif" } else { "png" };
    format!(
        "https://media.discordapp.net/stickers/{}.{}?size=160&passthrough=false",
        id, ext
    )
}

fn parse_single_sticker(val: &serde_json::Value) -> Option<StickerItem> {
    if let serde_json::Value::Object(map) = val {
        let id = map.get("id").and_then(id_to_string).unwrap_or_default();
        let format_type = map.get("format_type").and_then(|v| v.as_u64());
        let url = match map.get("url").and_then(|v| v.as_str()) {
            Some(u) => u.to_string(),
            None if !id.is_empty() => sticker_url(&id, format_type),
            None => return None,
        };

        return Some(StickerItem {
            id,
            name: map
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Sticker")
                .to_string(),
            url,
            format_type,
        });
    }

    let raw = id_to_string(val)?;
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }

    let is_url = raw.starts_with("http://") || raw.starts_with("https://");
    Some(StickerItem {
        id: if is_url { String::new() } else { raw.to_string() },
        name: "Sticker".to_string(),
        url: if is_url {
            raw.to_string()
        } else {
            sticker_url(raw, None)
        },
        format_type: None,
    })
}

fn extract_stickers(raw: &RawMessage) -> Vec<StickerItem> {
    let named = raw.stickers.iter().chain(raw.sticker_items.iter());
    let discovered = raw
        .extra
        .iter()
        .filter(|(k, _)| k.to_lowercase().contains("sticker"))
        .map(|(_, v)| v);

    let mut items: Vec<StickerItem> = named
        .chain(discovered)
        .flat_map(|val| match val {
            serde_json::Value::Array(arr) => arr.iter().filter_map(parse_single_sticker).collect(),
            other => parse_single_sticker(other).into_iter().collect::<Vec<_>>(),
        })
        .collect();

    let mut seen = HashSet::new();
    items.retain(|item| {
        let key = if item.id.is_empty() { &item.url } else { &item.id };
        seen.insert(key.clone())
    });

    items
}

fn nested_url(map: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<String> {
    map.get(key)
        .and_then(|v| v.get("url"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

fn extract_embeds(raw: &RawMessage) -> Vec<EmbedItem> {
    raw.extra
        .iter()
        .filter(|(k, _)| matches!(k.to_lowercase().as_str(), "embeds" | "embed"))
        .flat_map(|(_, v)| match v {
            serde_json::Value::Array(arr) => arr.clone(),
            serde_json::Value::Object(_) => vec![v.clone()],
            _ => Vec::new(),
        })
        .filter_map(|item| match item {
            serde_json::Value::Object(map) => Some(EmbedItem {
                title: map.get("title").and_then(|v| v.as_str()).map(str::to_string),
                description: map
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                url: map.get("url").and_then(|v| v.as_str()).map(str::to_string),
                image_url: nested_url(&map, "image").or_else(|| nested_url(&map, "video")),
                thumbnail_url: nested_url(&map, "thumbnail"),
                provider_name: map
                    .get("provider")
                    .and_then(|v| v.get("name"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
            }),
            _ => None,
        })
        .collect()
}

fn extract_call(raw: &RawMessage) -> Option<CallInfo> {
    if let Some(serde_json::Value::Object(map)) = raw.extra.get("call") {
        let duration_seconds = map.get("duration").and_then(|v| v.as_u64());
        let participants = map
            .get("participants")
            .and_then(|v| v.as_array())
            .map_or(0, |a| a.len());

        return Some(CallInfo {
            ended_timestamp: map
                .get("ended_timestamp")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            duration_seconds,
            is_missed: participants <= 1 || duration_seconds.unwrap_or(0) == 0,
        });
    }

    let t = raw.message_type_value()?;
    (t.as_i64() == Some(3) || t.as_str() == Some("CALL")).then(CallInfo::default)
}

fn classify_message(
    contents: &str,
    attachments: &[String],
    stickers: &[StickerItem],
    embeds: &[EmbedItem],
    call: Option<&CallInfo>,
    raw: &RawMessage,
) -> String {
    if call.is_some() {
        return "CALL".to_string();
    }

    if let Some(t) = raw.message_type_value() {
        let by_code = match t.as_i64() {
            Some(1) => Some("RECIPIENT_ADD"),
            Some(2) => Some("RECIPIENT_REMOVE"),
            Some(6) => Some("PIN_ADD"),
            Some(7) => Some("USER_JOIN"),
            Some(8..=11) => Some("GUILD_BOOST"),
            Some(18) => Some("THREAD_CREATED"),
            _ => None,
        };
        if let Some(kind) = by_code {
            return kind.to_string();
        }

        if let Some(s) = t.as_str() {
            let upper = s.to_uppercase();
            let by_name = [
                ("PIN", "PIN_ADD"),
                ("JOIN", "USER_JOIN"),
                ("BOOST", "GUILD_BOOST"),
                ("THREAD", "THREAD_CREATED"),
                ("CALL", "CALL"),
            ]
            .into_iter()
            .find(|(needle, _)| upper.contains(needle));

            if let Some((_, kind)) = by_name {
                return kind.to_string();
            }
        }
    }

    let flags = raw
        .extra
        .get("flags")
        .or_else(|| raw.extra.get("Flags"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if flags & 8192 != 0 {
        return "VOICE_MESSAGE".to_string();
    }

    if !stickers.is_empty() {
        return "STICKER".to_string();
    }

    let has_text = !contents.trim().is_empty();
    match (has_text, attachments.is_empty(), embeds.is_empty()) {
        (false, true, false) => "EMBED".to_string(),
        (false, false, _) => "ATTACHMENT".to_string(),
        (false, true, true) => "EMPTY".to_string(),
        _ => "DEFAULT".to_string(),
    }
}

fn summarise_messages(text: &str) -> (usize, Option<String>, Option<String>) {
    let Ok(msgs) = serde_json::from_str::<Vec<RawMessage>>(text) else {
        return (0, None, None);
    };

    let first = msgs.iter().map(|m| &m.timestamp).min().cloned();
    let last = msgs.iter().map(|m| &m.timestamp).max().cloned();
    (msgs.len(), first, last)
}

fn push_guild_channel(
    servers: &mut HashMap<String, Server>,
    server_names: &HashMap<String, String>,
    guild: GuildRef,
    channel: ChannelInfo,
) {
    servers
        .entry(guild.id.clone())
        .or_insert_with(|| Server {
            name: server_names.get(&guild.id).cloned().unwrap_or(guild.name),
            id: guild.id,
            channels: Vec::new(),
        })
        .channels
        .push(channel);
}

fn is_placeholder_name(name: &str) -> bool {
    name.is_empty() || name == "Unknown DM" || name == "unknown-channel"
}

fn min_opt(a: Option<String>, b: Option<String>) -> Option<String> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    }
}

fn max_opt(a: Option<String>, b: Option<String>) -> Option<String> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (a, b) => a.or(b),
    }
}

fn merge_duplicate_dms(dms: Vec<ChannelInfo>) -> Vec<ChannelInfo> {
    let mut merged: HashMap<String, ChannelInfo> = HashMap::new();

    for dm in dms {
        let key = match (dm.channel_type.as_str(), dm.recipient_id.as_deref()) {
            ("DM", Some(rid)) if !rid.is_empty() => format!("dm_{}", rid),
            _ => dm.folder_name.clone(),
        };

        match merged.get_mut(&key) {
            None => {
                merged.insert(key, dm);
            }
            Some(existing) => {
                existing.message_count += dm.message_count;
                for folder in &dm.folder_names {
                    if !existing.folder_names.contains(folder) {
                        existing.folder_names.push(folder.clone());
                    }
                }
                existing.folder_name = existing.folder_names.join(",");

                existing.first_message_timestamp = min_opt(
                    existing.first_message_timestamp.take(),
                    dm.first_message_timestamp,
                );
                existing.last_message_timestamp = max_opt(
                    existing.last_message_timestamp.take(),
                    dm.last_message_timestamp,
                );

                if is_placeholder_name(&existing.name) && !is_placeholder_name(&dm.name) {
                    existing.name = dm.name;
                }
            }
        }
    }

    let mut result: Vec<ChannelInfo> = merged.into_values().collect();
    result.sort_by(|a, b| b.message_count.cmp(&a.message_count));
    result
}

pub fn parse_data_package(path: &str) -> Result<DataIndex, String> {
    let mut package = Package::open(path)?;

    let display_names = Package::parse_index(package.source.read_messages_index());
    let server_names = Package::parse_index(
        package
            .source
            .read_root(&["servers", "Servers", "SERVERS"], "index.json"),
    );

    let account = package.account();
    let mut user_id = account.as_ref().map(|a| a.id_string()).unwrap_or_default();
    let username = account
        .and_then(|a| a.username.or(a.global_name))
        .unwrap_or_default();

    let mut servers_data: HashMap<String, Server> = HashMap::new();
    let mut direct_messages: Vec<ChannelInfo> = Vec::new();

    for folder_name in package.source.channel_folders() {
        let Some(channel_str) = package.source.read_channel(&folder_name, "channel.json") else {
            continue;
        };
        let Ok(meta) = serde_json::from_str::<ChannelMeta>(&channel_str) else {
            continue;
        };

        let (message_count, first_message_timestamp, last_message_timestamp) = package
            .source
            .read_channel(&folder_name, "messages.json")
            .map(|text| summarise_messages(&text))
            .unwrap_or((0, None, None));

        let channel_type = meta.channel_type_string();
        let recipient_ids = meta.extract_recipient_ids();

        let name = match channel_type.as_str() {
            "DM" | "GROUP_DM" => display_names
                .get(&folder_name)
                .or_else(|| display_names.get(folder_name.trim_start_matches('c')))
                .or_else(|| display_names.get(&meta.id))
                .map(|dn| {
                    dn.strip_prefix("Direct Message with ")
                        .unwrap_or(dn)
                        .to_string()
                })
                .or_else(|| (!recipient_ids.is_empty()).then(|| recipient_ids.join(", ")))
                .or_else(|| meta.name.clone())
                .unwrap_or_else(|| "Unknown DM".to_string()),
            _ => meta
                .name
                .clone()
                .unwrap_or_else(|| "unknown-channel".to_string()),
        };

        let channel_info = ChannelInfo {
            id: meta.id.clone(),
            name,
            channel_type: channel_type.clone(),
            message_count,
            guild_id: meta.guild.as_ref().map(|g| g.id.clone()),
            recipients: Some(recipient_ids),
            recipient_id: None,
            folder_name: folder_name.clone(),
            folder_names: vec![folder_name],
            first_message_timestamp,
            last_message_timestamp,
        };

        match (channel_type.as_str(), meta.guild) {
            ("DM" | "GROUP_DM", _) => direct_messages.push(channel_info),
            (_, Some(guild)) => {
                push_guild_channel(&mut servers_data, &server_names, guild, channel_info)
            }
            (t, None) if GUILD_CHANNEL_TYPES.contains(&t) => {}
            (_, None) => direct_messages.push(channel_info),
        }
    }

    if user_id.is_empty() {
        let mut counts: HashMap<&String, usize> = HashMap::new();
        for r in direct_messages
            .iter()
            .filter_map(|dm| dm.recipients.as_ref())
            .flatten()
        {
            *counts.entry(r).or_insert(0) += 1;
        }
        user_id = counts
            .into_iter()
            .max_by_key(|&(_, count)| count)
            .map(|(id, _)| id.clone())
            .unwrap_or_default();
    }

    for dm in &mut direct_messages {
        if let Some(recipients) = &dm.recipients {
            dm.recipient_id = recipients
                .iter()
                .find(|r| **r != user_id && !r.is_empty())
                .or_else(|| recipients.first())
                .cloned();
        }
    }

    let direct_messages = merge_duplicate_dms(direct_messages);

    let mut user_map: HashMap<String, String> = HashMap::new();
    if !user_id.is_empty() && !username.is_empty() {
        user_map.insert(user_id.clone(), username.clone());
    }

    for (folder, display) in &display_names {
        let cleaned = display
            .strip_prefix("Direct Message with ")
            .unwrap_or(display)
            .to_string();
        user_map.insert(folder.trim_start_matches('c').to_string(), cleaned.clone());
        user_map.insert(folder.clone(), cleaned);
    }

    for dm in &direct_messages {
        if is_placeholder_name(&dm.name) {
            continue;
        }
        let ids = dm
            .recipient_id
            .iter()
            .chain(dm.recipients.iter().flatten())
            .filter(|id| !id.is_empty() && **id != user_id);
        for id in ids {
            user_map.insert(id.clone(), dm.name.clone());
        }
    }

    let mut servers: Vec<Server> = servers_data.into_values().collect();
    for server in &mut servers {
        server.channels.sort_by(|a, b| a.name.cmp(&b.name));
    }
    servers.sort_by(|a, b| a.name.cmp(&b.name));

    for channel in servers.iter().flat_map(|s| &s.channels) {
        user_map.insert(channel.id.clone(), channel.name.clone());
    }

    Ok(DataIndex {
        servers,
        direct_messages,
        username,
        user_id,
        user_map,
    })
}

fn to_message(raw: RawMessage, default_user_id: Option<&String>) -> Message {
    let stickers = extract_stickers(&raw);
    let embeds = extract_embeds(&raw);
    let call_info = extract_call(&raw);

    let attachments: Vec<String> = raw
        .attachments
        .as_deref()
        .unwrap_or_default()
        .split(|c: char| c == ',' || c == ' ' || c == '\n')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();

    let contents = raw.contents.clone().unwrap_or_default();
    let message_type = classify_message(
        &contents,
        &attachments,
        &stickers,
        &embeds,
        call_info.as_ref(),
        &raw,
    );

    let author_id = raw
        .extra
        .get("author")
        .and_then(|v| v.get("id"))
        .or_else(|| raw.extra.get("author_id"))
        .or_else(|| raw.extra.get("user_id"))
        .and_then(id_to_string)
        .or_else(|| default_user_id.cloned());

    Message {
        id: id_to_string(&raw.id).unwrap_or_else(|| raw.id.to_string()),
        timestamp: raw.timestamp.clone(),
        contents,
        attachments,
        stickers,
        embeds,
        call_info,
        message_type,
        author: "You".to_string(),
        author_id,
    }
}

pub fn load_raw_message(
    data_path: &str,
    folder_name: &str,
    message_id: &str,
) -> Result<String, String> {
    let mut package = Package::open(data_path)?;

    for folder in folder_name.split(',').map(str::trim).filter(|f| !f.is_empty()) {
        let Some(text) = package.source.read_channel(folder, "messages.json") else {
            continue;
        };
        let Ok(msgs) = serde_json::from_str::<Vec<RawMessage>>(&text) else {
            continue;
        };
        if let Some(found) = msgs
            .iter()
            .find(|m| id_to_string(&m.id).as_deref() == Some(message_id))
        {
            return Ok(found.to_pretty_json());
        }
    }

    Err("Could not find that message in this channel.".to_string())
}

pub fn load_messages(
    data_path: &str,
    folder_name: &str,
    page: usize,
    page_size: usize,
) -> Result<MessagesResponse, String> {
    let mut package = Package::open(data_path)?;
    let default_user_id = package.account().map(|a| a.id_string());

    let folders: Vec<String> = folder_name
        .split(',')
        .map(str::trim)
        .filter(|f| !f.is_empty())
        .map(str::to_string)
        .collect();

    let mut raw_msgs: Vec<RawMessage> = Vec::new();
    for folder in folders {
        let Some(text) = package.source.read_channel(&folder, "messages.json") else {
            continue;
        };
        if let Ok(msgs) = serde_json::from_str::<Vec<RawMessage>>(&text) {
            raw_msgs.extend(msgs);
        }
    }

    raw_msgs.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

    let total = raw_msgs.len();
    let skip = if page_size == 0 { 0 } else { page * page_size };
    let take = if page_size == 0 { total } else { page_size };

    let messages = raw_msgs
        .into_iter()
        .skip(skip)
        .take(take)
        .map(|r| to_message(r, default_user_id.as_ref()))
        .collect();

    Ok(MessagesResponse { messages, total })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::OnceLock;

    const ALICE_MESSAGES: &str = r#"[
      {"ID":"m3","Timestamp":"2024-01-15T10:32:30.000+00:00","Contents":"third","Attachments":""},
      {"ID":"m1","Timestamp":"2024-01-15T10:30:00.000+00:00","Contents":"first","Attachments":""},
      {"ID":"m5","Timestamp":"2024-01-15T14:21:00.000+00:00","Contents":"fifth","Attachments":""},
      {"ID":"m2","Timestamp":"2024-01-15T10:31:00.000+00:00","Contents":"second","Attachments":""},
      {"ID":"m4","Timestamp":"2024-01-15T14:20:00.000+00:00","Contents":"fourth","Attachments":"https://cdn.example.com/meme.png"}
    ]"#;

    const BOB_MESSAGES: &str = r#"[
      {"ID":"b1","Timestamp":"2023-06-01T09:00:00.000+00:00","Contents":"hey bob","Attachments":""},
      {"ID":"b2","Timestamp":"2023-06-01T09:05:00.000+00:00","Contents":"still there?","Attachments":""}
    ]"#;

    const RILEY_EARLY: &str = r#"[
      {"ID":"r1","Timestamp":"2019-09-14T20:11:00.000+00:00","Contents":"hey, long time","Attachments":""},
      {"ID":"r2","Timestamp":"2019-09-14T20:30:00.000+00:00","Contents":"coffee sometime?","Attachments":""}
    ]"#;

    const RILEY_LATE: &str = r#"[
      {"ID":"r3","Timestamp":"2022-01-08T10:05:00.000+00:00","Contents":"this account is back","Attachments":""}
    ]"#;

    const GUILD_MESSAGES: &str = r#"[
      {"ID":"g1","Timestamp":"2023-02-02T12:00:00.000+00:00","Contents":"in a guild","Attachments":""}
    ]"#;

    static FIXTURE: OnceLock<PathBuf> = OnceLock::new();

    fn write_file(path: PathBuf, body: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    fn build_fixture() -> PathBuf {
        let root = std::env::temp_dir().join("discord-archiver-test-package");
        let _ = fs::remove_dir_all(&root);

        write_file(
            root.join("account/user.json"),
            r#"{"id":"123456789","username":"You"}"#,
        );
        write_file(
            root.join("servers/index.json"),
            r#"{"1001":"The Cool Server","1002":"Dev Hub"}"#,
        );
        write_file(
            root.join("messages/index.json"),
            r#"{"c001":"Direct Message with Alice","c002":"Direct Message with Bob","c003":"general","c004":"dev-talk","c005":"Direct Message with Riley","c006":"Direct Message with Riley"}"#,
        );

        write_file(
            root.join("messages/c001/channel.json"),
            r#"{"id":"001","type":"DM","name":"","recipients":["Alice#1234"]}"#,
        );
        write_file(root.join("messages/c001/messages.json"), ALICE_MESSAGES);

        write_file(
            root.join("messages/c002/channel.json"),
            r#"{"id":"002","type":"DM","name":"","recipients":["Bob#5678"]}"#,
        );
        write_file(root.join("messages/c002/messages.json"), BOB_MESSAGES);

        write_file(
            root.join("messages/c003/channel.json"),
            r#"{"id":"003","type":"GUILD_TEXT","name":"general","guild":{"id":"1001","name":"The Cool Server"}}"#,
        );
        write_file(root.join("messages/c003/messages.json"), GUILD_MESSAGES);

        write_file(
            root.join("messages/c004/channel.json"),
            r#"{"id":"004","type":"GUILD_TEXT","name":"dev-talk","guild":{"id":"1002","name":"Dev Hub"}}"#,
        );
        write_file(root.join("messages/c004/messages.json"), GUILD_MESSAGES);

        write_file(
            root.join("messages/c005/channel.json"),
            r#"{"id":"005","type":"DM","name":"","recipients":["Riley#0001"]}"#,
        );
        write_file(root.join("messages/c005/messages.json"), RILEY_EARLY);

        write_file(
            root.join("messages/c006/channel.json"),
            r#"{"id":"006","type":"DM","name":"","recipients":["Riley#0001"]}"#,
        );
        write_file(root.join("messages/c006/messages.json"), RILEY_LATE);

        root
    }

    fn fixture() -> String {
        FIXTURE.get_or_init(build_fixture).to_string_lossy().to_string()
    }

    fn index() -> DataIndex {
        parse_data_package(&fixture()).expect("fixture should parse")
    }

    fn alice(idx: &DataIndex) -> &ChannelInfo {
        idx.direct_messages
            .iter()
            .find(|d| d.name == "Alice")
            .expect("Alice DM")
    }

    #[test]
    fn reads_servers_and_dms_from_a_folder() {
        let idx = index();
        assert_eq!(idx.user_id, "123456789");
        assert_eq!(idx.username, "You");

        let names: Vec<&str> = idx.servers.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["Dev Hub", "The Cool Server"]);

        assert_eq!(idx.direct_messages.len(), 3);
        assert_eq!(alice(&idx).message_count, 5);
    }

    #[test]
    fn every_dm_exposes_a_recipient_id() {
        let idx = index();
        for dm in &idx.direct_messages {
            let id = dm.recipient_id.as_deref().unwrap_or("");
            assert!(!id.is_empty(), "{} has no recipient_id", dm.name);
            assert_ne!(id, idx.user_id, "{} resolved to the archive owner", dm.name);
        }
    }

    #[test]
    fn one_person_split_across_folders_merges_into_one_dm() {
        let idx = index();
        let riley: Vec<&ChannelInfo> = idx
            .direct_messages
            .iter()
            .filter(|d| d.name == "Riley")
            .collect();

        assert_eq!(riley.len(), 1, "split folders should collapse to one DM");
        let riley = riley[0];
        assert_eq!(riley.message_count, 3);
        assert_eq!(riley.folder_names.len(), 2);
        assert_eq!(
            riley.first_message_timestamp.as_deref(),
            Some("2019-09-14T20:11:00.000+00:00")
        );
        assert_eq!(
            riley.last_message_timestamp.as_deref(),
            Some("2022-01-08T10:05:00.000+00:00")
        );

        let res = load_messages(&fixture(), &riley.folder_name, 0, 0).expect("merged messages");
        let ids: Vec<&str> = res.messages.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["r1", "r2", "r3"]);
    }

    #[test]
    fn accepts_the_messages_folder_directly() {
        let messages_dir = format!("{}/messages", fixture());
        let idx = parse_data_package(&messages_dir).expect("messages dir should parse");
        assert_eq!(idx.user_id, "123456789");
        assert!(idx.servers.iter().any(|s| s.name == "The Cool Server"));
    }

    #[test]
    fn messages_are_sorted_even_when_the_file_is_not() {
        let idx = index();
        let res = load_messages(&fixture(), &alice(&idx).folder_name, 0, 0).expect("messages");

        assert_eq!(res.total, res.messages.len());
        let ids: Vec<&str> = res.messages.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["m1", "m2", "m3", "m4", "m5"]);
    }

    #[test]
    fn paging_returns_a_window_but_reports_the_full_total() {
        let idx = index();
        let folder = &alice(&idx).folder_name;

        let all = load_messages(&fixture(), folder, 0, 0).unwrap();
        let page = load_messages(&fixture(), folder, 1, 2).unwrap();

        assert_eq!(page.total, all.total);
        assert_eq!(page.messages.len(), 2);
        assert_eq!(page.messages[0].id, all.messages[2].id);
    }

    #[test]
    fn raw_message_is_fetched_by_id() {
        let idx = index();
        let raw = load_raw_message(&fixture(), &alice(&idx).folder_name, "m4").expect("raw json");
        assert!(raw.contains("\"m4\""));
        assert!(raw.contains("meme.png"));

        assert!(load_raw_message(&fixture(), &alice(&idx).folder_name, "nope").is_err());
    }

    fn zip_fixture(dest: &Path) {
        fn add_dir(writer: &mut zip::ZipWriter<std::fs::File>, dir: &Path, prefix: &str) {
            use std::io::Write;
            for entry in fs::read_dir(dir).unwrap().flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let path = entry.path();
                let zip_path = format!("{}/{}", prefix, name);
                if path.is_dir() {
                    add_dir(writer, &path, &zip_path);
                } else {
                    writer
                        .start_file(&zip_path, zip::write::SimpleFileOptions::default())
                        .unwrap();
                    writer.write_all(&fs::read(&path).unwrap()).unwrap();
                }
            }
        }

        let file = std::fs::File::create(dest).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        add_dir(&mut writer, Path::new(&fixture()), "discord-package");
        writer.finish().unwrap();
    }

    #[test]
    fn opens_a_zip_and_matches_the_folder() {
        let dir = std::env::temp_dir().join("discord-archiver-test-zip");
        let _ = fs::create_dir_all(&dir);
        let zip_path = dir.join("package.zip");
        zip_fixture(&zip_path);

        let from_zip = parse_data_package(&zip_path.to_string_lossy()).expect("zip should parse");
        let from_folder = index();

        assert_eq!(from_zip.user_id, from_folder.user_id);
        assert_eq!(from_zip.servers.len(), from_folder.servers.len());
        assert_eq!(from_zip.direct_messages.len(), from_folder.direct_messages.len());
        assert!(from_zip.servers.iter().any(|s| s.name == "The Cool Server"));

        let msgs = load_messages(
            &zip_path.to_string_lossy(),
            &alice(&from_zip).folder_name,
            0,
            0,
        )
        .unwrap();
        assert_eq!(msgs.total, 5);

        assert!(
            !std::env::temp_dir().join("discord-archiver").exists(),
            "a zip must be read in place, never extracted to temp"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_a_path_that_is_neither_folder_nor_zip() {
        let err = parse_data_package("F:/definitely/not/here")
            .err()
            .expect("a missing path should be an error");
        assert!(err.contains("does not exist"), "got: {}", err);
    }
}
