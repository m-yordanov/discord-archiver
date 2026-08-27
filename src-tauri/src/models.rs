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
    #[serde(rename = "ID")]
    pub id: serde_json::Value,
    #[serde(rename = "Timestamp")]
    pub timestamp: String,
    #[serde(rename = "Contents", default)]
    pub contents: Option<String>,
    #[serde(rename = "Attachments", default)]
    pub attachments: Option<String>,
    #[serde(rename = "Stickers", default)]
    pub stickers: Option<serde_json::Value>,
    #[serde(rename = "sticker_items", default)]
    pub sticker_items: Option<serde_json::Value>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl RawMessage {
    pub fn message_type_value(&self) -> Option<&serde_json::Value> {
        self.extra.get("type").or_else(|| self.extra.get("Type"))
    }

    pub fn to_pretty_json(&self) -> String {
        let mut map = serde_json::Map::new();
        map.insert("ID".to_string(), self.id.clone());
        map.insert(
            "Timestamp".to_string(),
            serde_json::Value::String(self.timestamp.clone()),
        );

        let named = [
            ("Contents", self.contents.clone().map(serde_json::Value::String)),
            ("Attachments", self.attachments.clone().map(serde_json::Value::String)),
            ("Stickers", self.stickers.clone()),
            ("sticker_items", self.sticker_items.clone()),
        ];
        for (key, value) in named {
            if let Some(v) = value {
                map.insert(key.to_string(), v);
            }
        }

        map.extend(self.extra.iter().map(|(k, v)| (k.clone(), v.clone())));
        serde_json::to_string_pretty(&serde_json::Value::Object(map)).unwrap_or_default()
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
    pub folder_name: String,
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
