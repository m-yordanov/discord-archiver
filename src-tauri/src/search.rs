use crate::archive::Source;
use crate::models::{id_to_string, DataIndex};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;

#[derive(Clone)]
pub struct SearchChannel {
    id: String,
    name: String,
    channel_type: String,
    server_name: Option<String>,
    folder_names: Vec<String>,
}

impl SearchChannel {
    fn is_direct_message(&self) -> bool {
        self.channel_type == "DM" || self.channel_type == "GROUP_DM"
    }
}

pub fn channels_of(index: &DataIndex) -> Vec<SearchChannel> {
    let dms = index.direct_messages.iter().map(|dm| (dm, None));
    let guild = index
        .servers
        .iter()
        .flat_map(|server| server.channels.iter().map(move |c| (c, Some(server.name.clone()))));

    dms.chain(guild)
        .map(|(channel, server_name)| SearchChannel {
            id: channel.id.clone(),
            name: channel.name.clone(),
            channel_type: channel.channel_type.clone(),
            server_name,
            folder_names: channel.folder_names.clone(),
        })
        .collect()
}

#[derive(Deserialize)]
struct RawSearchMessage<'a> {
    #[serde(rename = "ID", alias = "id")]
    id: serde_json::Value,
    #[serde(borrow, rename = "Timestamp", alias = "timestamp")]
    timestamp: Cow<'a, str>,
    #[serde(borrow, rename = "Contents", alias = "contents", default)]
    contents: Option<Cow<'a, str>>,
}

struct Entry {
    channel: u32,
    total_index: u32,
    start: usize,
    id_len: u16,
    timestamp_len: u16,
    contents_len: u32,
}

pub struct SearchCorpus {
    channels: Vec<SearchChannel>,
    entries: Vec<Entry>,
    text: String,
}

#[derive(Serialize)]
pub struct GlobalSearchMatch {
    pub channel_id: String,
    pub channel_name: String,
    pub channel_type: String,
    pub server_name: Option<String>,
    pub message_id: String,
    pub timestamp: String,
    pub contents: String,
    pub total_index: usize,
}

#[derive(Serialize)]
pub struct GlobalSearchResponse {
    pub matches: Vec<GlobalSearchMatch>,
    pub total_matches: usize,
    pub conversations: usize,
}

fn contains_ignore_case(haystack: &str, needle: &str) -> bool {
    if needle.is_ascii() {
        let needle = needle.as_bytes();
        haystack.len() >= needle.len()
            && haystack
                .as_bytes()
                .windows(needle.len())
                .any(|window| window.eq_ignore_ascii_case(needle))
    } else {
        haystack.to_lowercase().contains(needle)
    }
}

impl SearchCorpus {
    pub fn build(source: &mut Source, channels: Vec<SearchChannel>) -> Self {
        let mut entries = Vec::new();
        let mut text = String::new();

        for (channel_index, channel) in channels.iter().enumerate() {
            let texts: Vec<String> = channel
                .folder_names
                .iter()
                .filter_map(|folder| source.read_channel(folder, "messages.json"))
                .collect();

            let mut messages: Vec<RawSearchMessage> = texts
                .iter()
                .filter_map(|text| serde_json::from_str::<Vec<RawSearchMessage>>(text).ok())
                .flatten()
                .collect();
            messages.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

            for (total_index, message) in messages.into_iter().enumerate() {
                let Some(contents) = message.contents.filter(|c| !c.trim().is_empty()) else {
                    continue;
                };
                let id = id_to_string(&message.id).unwrap_or_default();
                let (Ok(id_len), Ok(timestamp_len), Ok(contents_len)) = (
                    u16::try_from(id.len()),
                    u16::try_from(message.timestamp.len()),
                    u32::try_from(contents.len()),
                ) else {
                    continue;
                };

                entries.push(Entry {
                    channel: channel_index as u32,
                    total_index: total_index as u32,
                    start: text.len(),
                    id_len,
                    timestamp_len,
                    contents_len,
                });
                text.push_str(&id);
                text.push_str(&message.timestamp);
                text.push_str(&contents);
            }
        }

        entries.shrink_to_fit();
        text.shrink_to_fit();
        SearchCorpus { channels, entries, text }
    }

    fn id(&self, entry: &Entry) -> &str {
        &self.text[entry.start..entry.start + entry.id_len as usize]
    }

    fn timestamp(&self, entry: &Entry) -> &str {
        let start = entry.start + entry.id_len as usize;
        &self.text[start..start + entry.timestamp_len as usize]
    }

    fn contents(&self, entry: &Entry) -> &str {
        let start = entry.start + entry.id_len as usize + entry.timestamp_len as usize;
        &self.text[start..start + entry.contents_len as usize]
    }

    pub fn search(&self, query: &str, scope: &str, limit: usize) -> GlobalSearchResponse {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return GlobalSearchResponse {
                matches: Vec::new(),
                total_matches: 0,
                conversations: 0,
            };
        }

        let in_scope: Vec<bool> = self
            .channels
            .iter()
            .map(|channel| match scope {
                "dms" => channel.is_direct_message(),
                "channels" => !channel.is_direct_message(),
                _ => true,
            })
            .collect();

        let mut hits: Vec<usize> = self
            .entries
            .iter()
            .enumerate()
            .filter(|(_, entry)| in_scope[entry.channel as usize])
            .filter(|(_, entry)| contains_ignore_case(self.contents(entry), &needle))
            .map(|(position, _)| position)
            .collect();

        let total_matches = hits.len();
        let mut matched_channels = vec![false; self.channels.len()];
        for &hit in &hits {
            matched_channels[self.entries[hit].channel as usize] = true;
        }

        let newest_first = |a: &usize, b: &usize| {
            self.timestamp(&self.entries[*b])
                .cmp(self.timestamp(&self.entries[*a]))
        };
        if limit > 0 && hits.len() > limit {
            hits.select_nth_unstable_by(limit - 1, newest_first);
            hits.truncate(limit);
        }
        hits.sort_by(newest_first);

        let matches = hits
            .into_iter()
            .map(|hit| {
                let entry = &self.entries[hit];
                let channel = &self.channels[entry.channel as usize];
                GlobalSearchMatch {
                    channel_id: channel.id.clone(),
                    channel_name: channel.name.clone(),
                    channel_type: channel.channel_type.clone(),
                    server_name: channel.server_name.clone(),
                    message_id: self.id(entry).to_string(),
                    timestamp: self.timestamp(entry).to_string(),
                    contents: self.contents(entry).to_string(),
                    total_index: entry.total_index as usize,
                }
            })
            .collect();

        GlobalSearchResponse {
            matches,
            total_matches,
            conversations: matched_channels.into_iter().filter(|&m| m).count(),
        }
    }
}
