use serde::de::{self, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt;

pub fn id_to_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

pub trait ChannelRecord {
    fn timestamp(&self) -> &str;
}

fn parse_records<'a, T: Deserialize<'a>>(text: &'a str) -> Vec<T> {
    serde_json::from_str::<Vec<&'a RawValue>>(text)
        .map(|records| {
            records
                .into_iter()
                .filter_map(|record| serde_json::from_str(record.get()).ok())
                .collect()
        })
        .unwrap_or_default()
}

pub fn ordered_records<'a, T: Deserialize<'a> + ChannelRecord>(
    texts: impl IntoIterator<Item = &'a str>,
) -> Vec<T> {
    let mut records: Vec<T> = texts.into_iter().flat_map(parse_records).collect();
    records.sort_by(|a, b| a.timestamp().cmp(b.timestamp()));
    records
}

struct LenientText;

impl<'de> Visitor<'de> for LenientText {
    type Value = Option<Cow<'de, str>>;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("any JSON value")
    }

    fn visit_borrowed_str<E: de::Error>(self, v: &'de str) -> Result<Self::Value, E> {
        Ok(Some(Cow::Borrowed(v)))
    }

    fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
        Ok(Some(Cow::Owned(v.to_string())))
    }

    fn visit_string<E: de::Error>(self, v: String) -> Result<Self::Value, E> {
        Ok(Some(Cow::Owned(v)))
    }

    fn visit_i64<E: de::Error>(self, v: i64) -> Result<Self::Value, E> {
        Ok(Some(Cow::Owned(v.to_string())))
    }

    fn visit_u64<E: de::Error>(self, v: u64) -> Result<Self::Value, E> {
        Ok(Some(Cow::Owned(v.to_string())))
    }

    fn visit_f64<E: de::Error>(self, v: f64) -> Result<Self::Value, E> {
        Ok(Some(Cow::Owned(v.to_string())))
    }

    fn visit_bool<E: de::Error>(self, _: bool) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_any(self)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        while seq.next_element::<IgnoredAny>()?.is_some() {}
        Ok(None)
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
        Ok(None)
    }
}

pub fn lenient_text<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Cow<'de, str>>, D::Error> {
    deserializer.deserialize_any(LenientText)
}

fn lenient_owned_text<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    lenient_text(deserializer).map(|text| text.map(Cow::into_owned))
}

#[derive(Deserialize)]
pub struct RawMessage {
    #[serde(rename = "ID", alias = "id")]
    pub id: serde_json::Value,
    #[serde(rename = "Timestamp", alias = "timestamp")]
    pub timestamp: String,
    #[serde(rename = "Contents", alias = "contents", default, deserialize_with = "lenient_owned_text")]
    pub contents: Option<String>,
    #[serde(rename = "Attachments", alias = "attachments", default, deserialize_with = "lenient_owned_text")]
    pub attachments: Option<String>,
    #[serde(rename = "Embeds", alias = "embeds", alias = "embed", default)]
    pub embeds: Option<serde_json::Value>,
    #[serde(rename = "Call", alias = "call", default)]
    pub call: Option<serde_json::Value>,
    #[serde(rename = "Flags", alias = "flags", default)]
    pub flags: Option<serde_json::Value>,
    #[serde(rename = "Type", alias = "type", default)]
    pub message_type: Option<serde_json::Value>,
    #[serde(rename = "Author", alias = "author", default)]
    pub author: Option<serde_json::Value>,
    #[serde(rename = "author_id", alias = "AuthorID", alias = "user_id", default)]
    pub author_id: Option<serde_json::Value>,
    #[serde(
        rename = "message_reference",
        alias = "MessageReference",
        alias = "reference",
        alias = "Reference",
        default
    )]
    pub message_reference: Option<serde_json::Value>,
    #[serde(rename = "referenced_message", alias = "ReferencedMessage", default)]
    pub referenced_message: Option<serde_json::Value>,
}

impl ChannelRecord for RawMessage {
    fn timestamp(&self) -> &str {
        &self.timestamp
    }
}

impl RawMessage {
    pub fn message_type_value(&self) -> Option<&serde_json::Value> {
        self.message_type.as_ref()
    }
}

#[derive(Deserialize)]
pub struct ChannelMeta {
    pub id: String,
    #[serde(rename = "type")]
    pub channel_type: serde_json::Value,
    pub name: Option<String>,
    pub recipients: Option<serde_json::Value>,
    pub guild: Option<GuildRef>,
}

impl ChannelMeta {
    pub fn channel_type_string(&self) -> String {
        match &self.channel_type {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Number(n) => match n.as_u64() {
                Some(0) => "GUILD_TEXT".to_string(),
                Some(1) => "DM".to_string(),
                Some(3) => "GROUP_DM".to_string(),
                Some(v) => format!("UNKNOWN_{}", v),
                None => "UNKNOWN".to_string(),
            },
            _ => "UNKNOWN".to_string(),
        }
    }

    pub fn extract_recipient_ids(&self) -> Vec<String> {
        let values = match &self.recipients {
            Some(serde_json::Value::Array(arr)) => arr.as_slice(),
            Some(other) => std::slice::from_ref(other),
            None => &[],
        };

        values
            .iter()
            .filter_map(|item| match item {
                serde_json::Value::Object(map) => map.get("id").and_then(id_to_string),
                other => id_to_string(other),
            })
            .collect()
    }
}

#[derive(Deserialize)]
pub struct GuildRef {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize)]
pub struct RawUserAccount {
    pub id: serde_json::Value,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub global_name: Option<String>,
}

impl RawUserAccount {
    pub fn id_string(&self) -> String {
        id_to_string(&self.id).unwrap_or_default()
    }
}

#[derive(Serialize, Clone)]
pub struct Server {
    pub id: String,
    pub name: String,
    pub channels: Vec<ChannelInfo>,
}

#[derive(Serialize, Clone)]
pub struct ChannelInfo {
    pub id: String,
    pub name: String,
    pub channel_type: String,
    pub message_count: usize,
    pub guild_id: Option<String>,
    pub recipients: Option<Vec<String>>,
    pub recipient_id: Option<String>,
    pub folder_names: Vec<String>,
    pub first_message_timestamp: Option<String>,
    pub last_message_timestamp: Option<String>,
}

#[derive(Serialize, Clone, Default)]
pub struct EmbedItem {
    pub title: Option<String>,
    pub description: Option<String>,
    pub url: Option<String>,
    pub image_url: Option<String>,
    pub thumbnail_url: Option<String>,
    pub provider_name: Option<String>,
}

#[derive(Serialize, Clone, Default)]
pub struct CallInfo {
    pub ended_timestamp: Option<String>,
    pub duration_seconds: Option<u64>,
    pub is_missed: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct MessageReference {
    pub message_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guild_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contents: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct Message {
    pub id: String,
    pub timestamp: String,
    pub contents: String,
    pub attachments: Vec<String>,
    pub embeds: Vec<EmbedItem>,
    pub call_info: Option<CallInfo>,
    pub message_type: String,
    pub author: String,
    pub author_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_reference: Option<MessageReference>,
}

#[derive(Serialize, Clone)]
pub struct DataIndex {
    pub servers: Vec<Server>,
    pub direct_messages: Vec<ChannelInfo>,
    pub username: String,
    pub user_id: String,
    pub user_map: HashMap<String, String>,
}

#[derive(Serialize, Clone)]
pub struct MessagesResponse {
    pub messages: Vec<Message>,
    pub total: usize,
}

#[derive(Serialize, Clone)]
pub struct SearchMatch {
    pub message: Message,
    pub total_index: usize,
}

#[derive(Serialize, Clone)]
pub struct SearchResponse {
    pub matches: Vec<SearchMatch>,
    pub total_matches: usize,
}

#[derive(Serialize, Clone)]
pub struct ChannelMediaItem {
    pub url: String,
    pub message_id: String,
    pub author: String,
    pub timestamp: String,
    pub filename: String,
    pub media_type: String,
}

#[derive(Serialize, Clone)]
pub struct DownloadResult {
    pub success: bool,
    pub count: usize,
    pub file_path: String,
    pub total_bytes: u64,
}

