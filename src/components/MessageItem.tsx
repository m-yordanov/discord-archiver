import { memo } from 'react';
import { Message } from '../types';
import { isImage, isVideo } from '../attachments';

const AUTHOR_COLORS = [
  '#ed4245', '#5865f2', '#3ba55c', '#faa61a',
  '#eb459e', '#9b59b6', '#1abc9c', '#e67e22',
];

const MENTION_PILL =
  'inline-flex items-center bg-dc-accent/20 hover:bg-dc-accent text-[#c9cdfb] hover:text-white ' +
  'px-1.5 py-0.5 rounded font-medium cursor-pointer transition-colors text-[13px] align-baseline mx-0.5';

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
  onError,
}: ClickableImageProps) {
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className={wrapperClassName}
      onClick={(e) => {
        if (onImageClick) {
          e.preventDefault();
          onImageClick(src);
        }
      }}
    >
      <img
        src={src}
        alt={alt}
        title={title}
        className={className}
        loading="lazy"
        onError={onError}
      />
    </a>
  );
}

interface MessageItemProps {
  message: Message;
  showHeader: boolean;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  userMap: Record<string, string>;
  onImageClick?: (url: string) => void;
  onContextMenu?: (e: React.MouseEvent, message: Message) => void;
  onMentionClick?: (userId: string, username?: string) => void;
  onMentionContextMenu?: (e: React.MouseEvent, userId: string, username?: string) => void;
  onChannelClick?: (channelId: string) => void;
  onChannelContextMenu?: (e: React.MouseEvent, channelId: string, channelName?: string) => void;
}

export const MessageItem = memo(function MessageItem({
  message,
  showHeader,
  searchQuery,
  isCurrentMatch,
  userMap,
  onImageClick,
  onContextMenu,
  onMentionClick,
  onMentionContextMenu,
  onChannelClick,
  onChannelContextMenu,
}: MessageItemProps) {
  const getAuthorColor = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AUTHOR_COLORS[Math.abs(hash) % AUTHOR_COLORS.length];
  };

  const parseTimestamp = (raw: string) => new Date(raw.replace(' ', 'T'));

  const formatTime = (isoString: string) =>
    parseTimestamp(isoString).toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

  const formatTimeHover = (isoString: string) =>
    parseTimestamp(isoString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

  const highlightText = (text: string) => {
    if (!searchQuery || !searchQuery.trim()) {
      return text;
    }
    const escaped = searchQuery.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === searchQuery.toLowerCase() ? (
        <mark key={i} className="bg-yellow-500/40 text-yellow-100 rounded px-0.5 py-0 font-medium">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const renderFormattedText = (rawText: string) => {
    if (!rawText) return null;

    const tokenRegex = /(https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(?:@me|\d+)\/\d+|<@!?\d+>|<#\d+>|<@&\d+>|<t:\d+(?::[a-zA-Z])?>)/g;
    const parts = rawText.split(tokenRegex);

    return parts.map((part, index) => {
      const discordUrlMatch = part.match(/^https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(?:@me|\d+)\/(\d+)$/);
      if (discordUrlMatch) {
        const channelId = discordUrlMatch[1];
        const chName = userMap[channelId];
        const handleClick = (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          onChannelClick?.(channelId);
        };
        const openMenu = (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          onChannelContextMenu?.(e, channelId, chName);
        };

        return (
          <span
            key={index}
            className={MENTION_PILL}
            title={`Channel ID: ${channelId}`}
            onClick={handleClick}
            onContextMenu={openMenu}
          >
            #{chName || channelId}
          </span>
        );
      }

      const userMatch = part.match(/^<@!?(\d+)>$/);
      if (userMatch) {
        const id = userMatch[1];
        const resolvedName = userMap[id];
        const openMentionMenu = (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          onMentionContextMenu?.(e, id, resolvedName);
        };
        const handleUserClick = (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          onMentionClick?.(id, resolvedName);
        };

        return resolvedName ? (
          <span
            key={index}
            className={MENTION_PILL}
            title={`User ID: ${id}`}
            onClick={handleUserClick}
            onContextMenu={openMentionMenu}
          >
            @{resolvedName}
          </span>
        ) : (
          <span
            key={index}
            className="cursor-pointer hover:underline text-dc-text-link"
            title={`User ID: ${id}`}
            onClick={handleUserClick}
            onContextMenu={openMentionMenu}
          >
            {part}
          </span>
        );
      }

      const channelMatch = part.match(/^<#(\d+)>$/);
      if (channelMatch) {
        const id = channelMatch[1];
        const chName = userMap[id];
        const handleChanClick = (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          onChannelClick?.(id);
        };
        const openChanMenu = (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          onChannelContextMenu?.(e, id, chName);
        };

        return chName ? (
          <span
            key={index}
            className={MENTION_PILL}
            title={`Channel ID: ${id}`}
            onClick={handleChanClick}
            onContextMenu={openChanMenu}
          >
            #{chName}
          </span>
        ) : (
          <span
            key={index}
            className="cursor-pointer hover:underline text-dc-text-link"
            title={`Channel ID: ${id}`}
            onClick={handleChanClick}
            onContextMenu={openChanMenu}
          >
            {part}
          </span>
        );
      }

      const timeMatch = part.match(/^<t:(\d+)(?::([a-zA-Z]))?>$/);
      if (timeMatch) {
        const d = new Date(parseInt(timeMatch[1], 10) * 1000);
        return (
          <span
            key={index}
            className="bg-dc-input/60 px-1 py-0.5 rounded text-xs text-dc-text-muted hover:text-white transition-colors"
            title={d.toLocaleString()}
          >
            {d.toLocaleDateString()}
          </span>
        );
      }

      return <span key={index}>{highlightText(part)}</span>;
    });
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

  return (
    <div
      id={`msg-${message.id}`}
      className={`hover:bg-dc-hover group px-4 py-0.5 ${showHeader ? 'mt-4' : ''} flex relative transition-colors ${
        isCurrentMatch ? 'bg-dc-accent/20 ring-1 ring-dc-accent/60 rounded' : ''
      }`}
    >
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
                return (
                  <video
                    key={i}
                    src={url}
                    controls
                    className="max-h-[300px] max-w-[400px] rounded-lg bg-black"
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
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-dc-text-link hover:underline truncate block"
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
  );
});
