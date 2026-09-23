import { memo } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Message, ChannelInfo } from '../types';
import { isImage, isVideo, isAudio } from '../attachments';
import { DiscordMarkdown } from './DiscordMarkdown';
import { AudioPlayer } from './AudioPlayer';
import { useResolvedUrl, getResolvedUrl } from '../urlResolver';
import { TimeFormat } from '../settings';

const handleExternalUrlClick = (e: React.MouseEvent, url: string) => {
  e.preventDefault();
  e.stopPropagation();
  openUrl(url).catch((err) => {
    console.error('Failed to open link:', err);
    window.open(url, '_blank');
  });
};

const AUTHOR_COLORS = [
  '#ed4245', '#5865f2', '#3ba55c', '#faa61a',
  '#eb459e', '#9b59b6', '#1abc9c', '#e67e22',
];

interface ClickableImageProps {
  src: string;
  alt: string;
  className: string;
  wrapperClassName?: string;
  title?: string;
  onImageClick?: (url: string) => void;
  onError?: React.ReactEventHandler<HTMLImageElement>;
}

function ClickableImage({
  src,
  alt,
  className,
  wrapperClassName,
  title,
  onImageClick,
}: ClickableImageProps) {
  const { resolvedUrl, isFailed, reportError } = useResolvedUrl(src);

  if (isFailed) {
    return (
      <div className="inline-flex items-center gap-2 p-2.5 rounded-lg bg-dc-dark border border-dc-input/60 max-w-[360px] text-xs text-dc-text select-none">
        <span className="text-base">⚠️</span>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="font-semibold text-white truncate text-[11px]">Media Expired</span>
          <span className="text-[10px] text-dc-text-muted truncate">{src.split('?')[0].split('/').pop()}</span>
        </div>
      </div>
    );
  }

  return (
    <a
      href={resolvedUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`${wrapperClassName || 'inline-block'} relative group`}
      onClick={(e) => {
        if (onImageClick) {
          e.preventDefault();
          onImageClick(resolvedUrl);
        }
      }}
    >
      <img
        src={resolvedUrl}
        alt={alt}
        title={title}
        className={className}
        loading="lazy"
        onError={reportError}
      />
    </a>
  );
}

function VideoAttachment({ src }: { src: string }) {
  const { resolvedUrl, isFailed, reportError } = useResolvedUrl(src);

  if (isFailed) {
    return (
      <div className="inline-flex items-center gap-2 p-2.5 rounded-lg bg-dc-dark border border-dc-input/60 max-w-[360px] text-xs text-dc-text select-none">
        <span className="text-base">⚠️</span>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="font-semibold text-white truncate text-[11px]">Media Expired</span>
          <span className="text-[10px] text-dc-text-muted truncate">{src.split('?')[0].split('/').pop()}</span>
        </div>
      </div>
    );
  }

  return (
    <video
      src={resolvedUrl}
      controls
      className="max-h-[300px] max-w-[400px] rounded-lg bg-black"
      onError={reportError}
    />
  );
}

interface MessageItemProps {
  message: Message;
  showHeader: boolean;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  isHighlighted?: boolean;
  referencedMessage?: Message | null;
  selectedChannel?: ChannelInfo | null;
  userMap: Record<string, string>;
  onImageClick?: (url: string) => void;
  onContextMenu?: (e: React.MouseEvent, message: Message) => void;
  onMentionClick?: (userId: string, username?: string) => void;
  onMentionContextMenu?: (e: React.MouseEvent, userId: string, username?: string) => void;
  onChannelClick?: (channelId: string) => void;
  onChannelContextMenu?: (e: React.MouseEvent, channelId: string, channelName?: string) => void;
  onLinkContextMenu?: (e: React.MouseEvent, url: string) => void;
  onJumpToMessage?: (messageId: string) => void;
  onReplyContextMenu?: (e: React.MouseEvent, messageId: string) => void;
  timeFormat?: TimeFormat;
}

export const MessageItem = memo(function MessageItem({
  message,
  showHeader,
  searchQuery,
  isCurrentMatch,
  isHighlighted,
  referencedMessage,
  selectedChannel,
  userMap,
  onImageClick,
  onContextMenu,
  onMentionClick,
  onMentionContextMenu,
  onChannelClick,
  onChannelContextMenu,
  onLinkContextMenu,
  onJumpToMessage,
  onReplyContextMenu,
  timeFormat = '12h',
}: MessageItemProps) {
  const getAuthorColor = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AUTHOR_COLORS[Math.abs(hash) % AUTHOR_COLORS.length];
  };

  const parseTimestamp = (raw: string) => new Date(raw.replace(' ', 'T'));

  const formatTime = (isoString: string) => {
    const is24h = timeFormat === '24h';
    return parseTimestamp(isoString).toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: !is24h,
      ...(is24h ? { hourCycle: 'h23' } : {}),
    });
  };

  const formatTimeHover = (isoString: string) => {
    const is24h = timeFormat === '24h';
    return parseTimestamp(isoString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: !is24h,
      ...(is24h ? { hourCycle: 'h23' } : {}),
    });
  };

  const renderFormattedText = (rawText: string) => {
    if (!rawText) return null;
    return (
      <DiscordMarkdown
        content={rawText}
        userMap={userMap}
        searchQuery={searchQuery}
        onMentionClick={onMentionClick}
        onMentionContextMenu={onMentionContextMenu}
        onChannelClick={onChannelClick}
        onChannelContextMenu={onChannelContextMenu}
        onLinkContextMenu={onLinkContextMenu}
        onExternalUrlClick={handleExternalUrlClick}
      />
    );
  };

  const handleStickerError = (name: string) => (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.currentTarget;
    if (target.src.includes('.png?size=160')) {
      target.src = target.src.replace('.png?size=160', '.gif?size=160');
    } else if (target.src.includes('.gif?size=160')) {
      target.src = target.src.replace('.gif?size=160', '.webp?size=160');
    } else {
      target.style.display = 'none';
      const fallback = document.createElement('div');
      fallback.textContent = `[Sticker: ${name}]`;
      fallback.className =
        'text-xs text-dc-text-muted bg-dc-dark px-2.5 py-1.5 rounded border border-dc-input inline-block';
      target.parentElement?.appendChild(fallback);
    }
  };

  const authorColor = getAuthorColor(message.author);

  const hasContents = Boolean(message.contents && message.contents.trim().length > 0);
  const hasAttachments = Boolean(message.attachments && message.attachments.length > 0);
  const hasStickers = Boolean(message.stickers && message.stickers.length > 0);
  const hasEmbeds = Boolean(message.embeds && message.embeds.length > 0);
  const isCall = message.message_type === 'CALL' || Boolean(message.call_info);
  const isPin = message.message_type === 'PIN_ADD';
  const isEmpty =
    !hasContents && !hasAttachments && !hasStickers && !hasEmbeds && !isCall && !isPin;

  const hasReply = Boolean(message.message_reference);
  let replyAuthor = 'Original message';
  let replySnippet = '';

  if (message.message_reference) {
    if (message.message_reference.author) {
      replyAuthor = message.message_reference.author;
    } else if (referencedMessage?.author) {
      replyAuthor = referencedMessage.author;
    } else if (selectedChannel?.channel_type === 'DM' && message.author === 'You') {
      const dmName = selectedChannel.name.replace(/^Direct Message with /, '');
      replyAuthor = dmName || 'User';
    }

    if (message.message_reference.contents) {
      replySnippet = message.message_reference.contents;
    } else if (referencedMessage) {
      if (referencedMessage.contents && referencedMessage.contents.trim().length > 0) {
        replySnippet = referencedMessage.contents;
      } else if (referencedMessage.attachments && referencedMessage.attachments.length > 0) {
        if (
          referencedMessage.message_type === 'VOICE_MESSAGE' ||
          referencedMessage.attachments.some(isAudio)
        ) {
          replySnippet = '[Voice Message]';
        } else {
          replySnippet = '[Attachment]';
        }
      } else if (referencedMessage.stickers && referencedMessage.stickers.length > 0) {
        replySnippet = `[Sticker: ${referencedMessage.stickers[0]?.name || 'Sticker'}]`;
      } else if (referencedMessage.embeds && referencedMessage.embeds.length > 0) {
        replySnippet = `[Embed: ${referencedMessage.embeds[0]?.title || 'Embed'}]`;
      } else if (referencedMessage.call_info) {
        replySnippet = '[Call]';
      } else {
        replySnippet = '[Message]';
      }
    } else {
      replySnippet = 'Original message was deleted or not in archive';
    }
  }

  const replyAuthorColor = getAuthorColor(replyAuthor);

  return (
    <div
      id={`msg-${message.id}`}
      className={`hover:bg-dc-hover group px-4 py-0.5 ${
        showHeader ? (hasReply ? 'mt-2' : 'mt-4') : ''
      } flex flex-col relative transition-colors ${
        isHighlighted
          ? 'bg-dc-accent/30 ring-2 ring-dc-accent rounded'
          : isCurrentMatch
          ? 'bg-dc-accent/20 ring-1 ring-dc-accent/60 rounded'
          : ''
      }`}
    >
      {hasReply && (
        <div
          className="flex items-center gap-1.5 text-xs text-dc-text-muted mb-1 ml-4 cursor-pointer select-none group/reply hover:text-white"
          onClick={(e) => {
            e.stopPropagation();
            onJumpToMessage?.(message.message_reference!.message_id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onReplyContextMenu?.(e, message.message_reference!.message_id);
          }}
          title={`Jump to message (${message.message_reference!.message_id})`}
        >
          <svg
            className="w-8 h-3.5 text-[#4e5058] group-hover/reply:text-white shrink-0 overflow-visible ml-1 transition-colors"
            viewBox="0 0 32 14"
            fill="none"
          >
            <path
              d="M 12 17 V 7 A 6 6 0 0 1 18 1 H 32"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>

          <div
            className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] text-white font-bold shrink-0 overflow-hidden"
            style={{ backgroundColor: replyAuthorColor }}
          >
            {replyAuthor.charAt(0).toUpperCase()}
          </div>

          <span
            className="font-semibold text-xs hover:underline shrink-0"
            style={{ color: replyAuthorColor }}
          >
            @{replyAuthor}
          </span>

          <span className="truncate max-w-[500px] text-dc-text-muted group-hover/reply:text-dc-text text-xs">
            {replySnippet}
          </span>
        </div>
      )}

      <div className="flex w-full">
        {showHeader ? (
          <div
            className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-white font-medium mr-4 mt-0.5 overflow-hidden cursor-pointer"
            style={{ backgroundColor: authorColor }}
            onContextMenu={(e) => {
              e.preventDefault();
              onContextMenu?.(e, message);
            }}
          >
            {message.author.charAt(0).toUpperCase()}
          </div>
        ) : (
          <div className="w-14 shrink-0 text-right pr-4 opacity-0 group-hover:opacity-100 text-[10px] text-dc-text-muted self-start mt-[3px]">
            {formatTimeHover(message.timestamp)}
          </div>
        )}

        <div className="flex-1 min-w-0">
        {showHeader && (
          <div className="flex items-baseline mb-1">
            <span
              className="font-medium mr-2 hover:underline cursor-pointer"
              style={{ color: authorColor }}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu?.(e, message);
              }}
            >
              {message.author}
            </span>
            <span className="text-xs text-dc-text-muted">{formatTime(message.timestamp)}</span>
          </div>
        )}

        {isCall && (
          <div className="flex items-center gap-2 text-dc-text text-sm my-1 py-1 px-3 bg-dc-dark/40 rounded border border-dc-input/40">
            <span className="text-dc-green text-base">📞</span>
            <span className="font-semibold text-white">{message.author}</span>
            <span className="text-dc-text-muted">started a call.</span>
            {message.call_info?.duration_seconds ? (
              <span className="text-xs text-dc-text-muted">
                ({Math.floor(message.call_info.duration_seconds / 60)}m{' '}
                {message.call_info.duration_seconds % 60}s)
              </span>
            ) : null}
          </div>
        )}

        {isPin && (
          <div className="flex items-center gap-2 text-dc-text text-sm my-1 py-1">
            <span className="text-base">📌</span>
            <span className="font-semibold text-white">{message.author}</span>
            <span className="text-dc-text-muted">pinned a message to this channel.</span>
          </div>
        )}

        {hasContents && (
          <div className="text-dc-text whitespace-pre-wrap break-words leading-tight">
            {renderFormattedText(message.contents)}
          </div>
        )}

        {isEmpty && (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-dc-dark/50 rounded border border-dc-input/40 text-xs text-dc-text-muted select-none mt-0.5">
            <span className="opacity-60 text-xs">⚠️</span>
            <span>[Content could not be retrieved]</span>
          </div>
        )}

        {hasAttachments && (
          <div className="mt-2 flex flex-col gap-2">
            {message.attachments.map((url, i) => {
              if (isImage(url)) {
                return (
                  <ClickableImage
                    key={i}
                    src={url}
                    alt="attachment"
                    wrapperClassName="inline-block max-w-[400px]"
                    className="max-h-[300px] max-w-full rounded-lg object-contain bg-dc-dark/30 hover:opacity-95 transition-opacity cursor-pointer"
                    onImageClick={onImageClick}
                  />
                );
              }

              if (isVideo(url)) {
                return <VideoAttachment key={i} src={url} />;
              }

              if (isAudio(url) || message.message_type === 'VOICE_MESSAGE') {
                const isVoice =
                  message.message_type === 'VOICE_MESSAGE' ||
                  url.toLowerCase().includes('voice-message') ||
                  url.toLowerCase().includes('voice_message');
                return (
                  <AudioPlayer
                    key={i}
                    src={url}
                    isVoiceMessage={isVoice}
                    onLinkContextMenu={onLinkContextMenu}
                  />
                );
              }

              return (
                <div
                  key={i}
                  className="flex items-center gap-2 p-3 bg-dc-dark rounded border border-dc-input max-w-md"
                >
                  <span className="text-xl">📎</span>
                  <div className="flex-1 truncate">
                    <a
                      href={getResolvedUrl(url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-dc-text-link hover:underline truncate block"
                      onClick={(e) => handleExternalUrlClick(e, getResolvedUrl(url))}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onLinkContextMenu?.(e, url);
                      }}
                    >
                      {url.split('/').pop() || 'Attachment'}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {hasEmbeds && (
          <div className="mt-2 flex flex-col gap-2">
            {message.embeds!.map((embed, i) => {
              const hasEmbedMedia = embed.image_url || embed.thumbnail_url;
              const hasEmbedText = embed.title || embed.description || embed.provider_name;

              if (!hasEmbedText && !hasEmbedMedia && !embed.url) {
                return null;
              }

              return (
                <div
                  key={i}
                  className="bg-dc-dark/70 border-l-4 border-dc-accent rounded-r p-3 max-w-lg flex flex-col gap-1.5 text-sm"
                >
                  {embed.provider_name && (
                    <div className="text-xs text-dc-text-muted font-medium">
                      {renderFormattedText(embed.provider_name)}
                    </div>
                  )}

                  {embed.title && (
                    <div className="font-semibold text-white">
                      {embed.url ? (
                        <a
                          href={embed.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-dc-text-link hover:underline"
                          onClick={(e) => handleExternalUrlClick(e, embed.url!)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onLinkContextMenu?.(e, embed.url!);
                          }}
                        >
                          {renderFormattedText(embed.title)}
                        </a>
                      ) : (
                        renderFormattedText(embed.title)
                      )}
                    </div>
                  )}

                  {embed.description && (
                    <div className="text-dc-text text-xs whitespace-pre-wrap">
                      {renderFormattedText(embed.description)}
                    </div>
                  )}

                  {embed.image_url && (
                    <div className="mt-1">
                      <ClickableImage
                        src={embed.image_url}
                        alt="embed media"
                        className="max-h-[240px] max-w-full rounded object-contain cursor-pointer"
                        onImageClick={onImageClick}
                      />
                    </div>
                  )}

                  {embed.thumbnail_url && !embed.image_url && (
                    <div className="mt-1">
                      <ClickableImage
                        src={embed.thumbnail_url}
                        alt="embed thumbnail"
                        className="max-h-[120px] max-w-[120px] rounded object-contain cursor-pointer"
                        onImageClick={onImageClick}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {hasStickers && (
          <div className="mt-2 flex flex-col gap-2">
            {message.stickers!.map((sticker, i) => {
              const name = sticker.name || sticker.id || 'Sticker';
              return (
                <div key={sticker.id || i} className="inline-block">
                  <ClickableImage
                    src={sticker.url}
                    alt={name}
                    title={name}
                    className="w-[160px] h-[160px] max-w-[160px] max-h-[160px] object-contain rounded-lg cursor-pointer hover:scale-105 transition-transform"
                    onImageClick={onImageClick}
                    onError={handleStickerError(name)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  </div>
);
});
