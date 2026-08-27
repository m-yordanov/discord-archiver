export interface Server {
  id: string;
  name: string;
  channels: ChannelInfo[];
}

export interface ChannelInfo {
  id: string;
  name: string;
  channel_type: string;
  message_count: number;
  guild_id: string | null;
  recipients: string[] | null;
  recipient_id: string | null;
  folder_name: string;
  folder_names: string[];
  first_message_timestamp: string | null;
  last_message_timestamp: string | null;
}

export interface StickerItem {
  id: string;
  name: string;
  url: string;
  format_type: number | null;
}

export interface EmbedItem {
  title: string | null;
  description: string | null;
  url: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  provider_name: string | null;
}

export interface CallInfo {
  ended_timestamp: string | null;
  duration_seconds: number | null;
  is_missed: boolean;
}

export interface Message {
  id: string;
  timestamp: string;
  contents: string;
  attachments: string[];
  stickers: StickerItem[];
  embeds: EmbedItem[];
  call_info: CallInfo | null;
  message_type: string;
  author: string;
  author_id: string | null;
}

export interface DataIndex {
  servers: Server[];
  direct_messages: ChannelInfo[];
  username: string;
  user_id: string;
  user_map: Record<string, string>;
}

export interface MessagesResponse {
  messages: Message[];
  total: number;
}
