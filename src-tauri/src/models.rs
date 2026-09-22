use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub fn id_to_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

#[derive(Deserialize)]
pub struct RawMessage {
    #[serde(rename = "ID", alias = "id")]
    pub id: serde_json::Value,
    #[serde(rename = "Timestamp", alias = "timestamp")]
    pub timestamp: String,
    #[serde(rename = "Contents", alias = "contents", default)]
    pub contents: Option<String>,
    #[serde(rename = "Attachments", alias = "attachments", default)]
    pub attachments: Option<String>,
    #[serde(rename = "Stickers", alias = "stickers", default)]
    pub stickers: Option<serde_json::Value>,
    #[serde(rename = "sticker_items", alias = "StickerItems", default)]
    pub sticker_items: Option<serde_json::Value>,
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

#[derive(Serialize, Clone)]
pub struct StickerItem {
    pub id: String,
    pub name: String,
    pub url: String,
    pub format_type: Option<u64>,
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
    pub stickers: Vec<StickerItem>,
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
