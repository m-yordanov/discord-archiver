import { useState, useEffect, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ArrowLeft, Download, FileText, Film, Image as ImageIcon, Music, Search } from 'lucide-react';
import { ChannelInfo, ChannelMediaItem, DownloadResult } from '../types';
import { useResolvedUrl, getResolvedUrl } from '../urlResolver';

interface MediaGalleryProps {
  selectedChannel: ChannelInfo;
  dataPath: string | null;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
  onImageClick: (url: string) => void;
  onLinkContextMenu?: (e: React.MouseEvent, url: string) => void;
}

type MediaFilterTab = 'all' | 'image' | 'video' | 'audio' | 'file';

function GalleryImageItem({
  item,
  onImageClick,
  onOpenLink,
  onLinkContextMenu,
  onJumpToMessage,
}: {
  item: ChannelMediaItem;
  onImageClick: (url: string) => void;
  onOpenLink: (e: React.MouseEvent, url: string) => void;
  onLinkContextMenu?: (e: React.MouseEvent, url: string) => void;
  onJumpToMessage: (messageId: string) => void;
}) {
  const { resolvedUrl, isFailed, reportError } = useResolvedUrl(item.url);

  if (isFailed) {
    return (
      <div className="group relative aspect-square bg-dc-dark rounded-xl overflow-hidden border border-dc-input/40 flex flex-col justify-between p-3 select-none">
        <div className="flex items-center justify-between">
          <span className="text-base">⚠️</span>
          <button
            type="button"
            onClick={e => onOpenLink(e, resolvedUrl)}
            onContextMenu={e => onLinkContextMenu?.(e, resolvedUrl)}
            className="text-dc-text-muted hover:text-white text-xs cursor-pointer"
            title="Open link"
          >
            🔗
          </button>
        </div>

        <div className="flex flex-col items-center justify-center my-auto">
          <span className="text-[11px] font-semibold text-white">Media Expired</span>
        </div>

        <div className="flex flex-col gap-1 min-w-0 bg-dc-darker/90 p-2 rounded-lg">
          <span className="text-[11px] font-semibold text-white truncate" title={item.filename}>
            {item.filename}
          </span>
          <div className="flex items-center justify-between text-[10px] text-gray-300">
            <span className="truncate">{item.author}</span>
            <span>{item.timestamp.slice(0, 10)}</span>
          </div>
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onJumpToMessage(item.message_id);
            }}
            className="mt-1 w-full py-1 rounded bg-dc-accent/90 hover:bg-dc-accent text-white text-[10px] font-semibold transition-colors cursor-pointer"
          >
            Jump to Message
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group relative aspect-square bg-dc-dark rounded-xl overflow-hidden border border-dc-input/40 hover:border-dc-accent/80 transition-all shadow-sm cursor-pointer"
      onClick={() => onImageClick(resolvedUrl)}
    >
      <img
        src={resolvedUrl}
        alt={item.filename}
        loading="lazy"
        onError={reportError}
        className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
      />

      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={e => onOpenLink(e, resolvedUrl)}
            onContextMenu={e => onLinkContextMenu?.(e, resolvedUrl)}
            className="p-1 rounded bg-black/60 hover:bg-black text-white text-[11px] transition-colors cursor-pointer"
            title="Open original"
          >
            🔗
          </button>
        </div>

        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[11px] font-semibold text-white truncate" title={item.filename}>
            {item.filename}
          </span>
          <div className="flex items-center justify-between text-[10px] text-gray-300">
            <span className="truncate">{item.author}</span>
            <span>{item.timestamp.slice(0, 10)}</span>
          </div>
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onJumpToMessage(item.message_id);
            }}
            className="mt-1 w-full py-1 rounded bg-dc-accent/90 hover:bg-dc-accent text-white text-[10px] font-semibold transition-colors cursor-pointer"
          >
            Jump to Message
          </button>
        </div>
      </div>
    </div>
  );
}

export function MediaGallery({
  selectedChannel,
  dataPath,
  onClose,
  onJumpToMessage,
  onImageClick,
  onLinkContextMenu,
}: MediaGalleryProps) {
  const [items, setItems] = useState<ChannelMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<MediaFilterTab>('all');
  const [search, setSearch] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setError(null);

    invoke<ChannelMediaItem[]>('get_channel_media', {
      dataPath,
      folderNames: selectedChannel.folder_names,
    })
      .then(res => {
        if (!isCancelled) {
          setItems(res);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!isCancelled) {
          setError(typeof err === 'string' ? err : 'Failed to load media');
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [dataPath, selectedChannel]);

  const counts = useMemo(() => {
    return {
      all: items.length,
      image: items.filter(i => i.media_type === 'image').length,
      video: items.filter(i => i.media_type === 'video').length,
      audio: items.filter(i => i.media_type === 'audio').length,
      file: items.filter(i => i.media_type === 'file').length,
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    let result = items;
    if (tab !== 'all') {
      result = result.filter(i => i.media_type === tab);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        i =>
          i.filename.toLowerCase().includes(q) ||
          i.author.toLowerCase().includes(q) ||
          i.timestamp.toLowerCase().includes(q)
      );
    }
    return result;
  }, [items, tab, search]);

  const handleDownloadAll = async () => {
    if (items.length === 0 || isDownloading) return;

    const safeName = (selectedChannel.name || 'channel').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = await save({
      defaultPath: `${safeName}_media.zip`,
      filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
    });

    if (!filePath) return;

    setIsDownloading(true);
    try {
      const result = await invoke<DownloadResult>('download_channel_media', {
        dataPath,
        folderNames: selectedChannel.folder_names,
        savePath: filePath,
      });

      const mb = (result.total_bytes / (1024 * 1024)).toFixed(1);
      showToast(`Saved ${result.count} files (${mb} MB) to zip archive`);
    } catch {
      showToast('Failed to create media zip archive');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleOpenLink = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    openUrl(url).catch(() => window.open(url, '_blank'));
  };

  return (
    <div className="flex-1 bg-dc-darkest flex flex-col min-w-0 h-full relative select-none">
      <div className="h-12 flex items-center justify-between px-4 border-b border-dc-dark shrink-0 gap-3">
        <div className="flex items-center min-w-0 gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-dc-dark hover:bg-dc-hover text-dc-text hover:text-white text-xs border border-dc-input/60 transition-colors cursor-pointer"
            title="Back to messages"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Messages</span>
          </button>

          <div className="flex items-center gap-2 truncate">
            <span className="font-bold text-white text-sm truncate">
              {selectedChannel.name || 'Channel'} Media
            </span>
            <span className="text-xs text-dc-text-muted">({items.length} items)</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="relative flex items-center bg-dc-dark rounded px-2.5 py-1 text-xs text-dc-text border border-dc-input/60 focus-within:border-dc-accent transition-colors">
            <Search className="w-3.5 h-3.5 text-dc-text-muted mr-1.5 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by name or author..."
              className="bg-transparent border-none outline-none text-white text-xs w-44 placeholder:text-dc-text-muted"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="text-dc-text-muted hover:text-white text-xs cursor-pointer ml-1"
              >
                ✕
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleDownloadAll}
            disabled={items.length === 0 || isDownloading}
            className="flex items-center gap-1.5 px-3 py-1 rounded bg-dc-accent hover:bg-dc-accent-hover text-white text-xs font-semibold shadow transition-all cursor-pointer disabled:opacity-50 disabled:cursor-default"
            title="Download all media from this channel in a .zip file"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isDownloading ? 'Packaging...' : 'Download All (.zip)'}</span>
          </button>
        </div>
      </div>

      <div className="h-10 px-4 border-b border-dc-dark bg-dc-darker/50 flex items-center gap-1 shrink-0 overflow-x-auto">
        <button
          type="button"
          onClick={() => setTab('all')}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
            tab === 'all'
              ? 'bg-dc-accent text-white'
              : 'text-dc-text-muted hover:text-white hover:bg-dc-hover'
          }`}
        >
          All ({counts.all})
        </button>

        <button
          type="button"
          onClick={() => setTab('image')}
          className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
            tab === 'image'
              ? 'bg-dc-accent text-white'
              : 'text-dc-text-muted hover:text-white hover:bg-dc-hover'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>Photos ({counts.image})</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('video')}
          className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
            tab === 'video'
              ? 'bg-dc-accent text-white'
              : 'text-dc-text-muted hover:text-white hover:bg-dc-hover'
          }`}
        >
          <Film className="w-3.5 h-3.5" />
          <span>Videos ({counts.video})</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('audio')}
          className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
            tab === 'audio'
              ? 'bg-dc-accent text-white'
              : 'text-dc-text-muted hover:text-white hover:bg-dc-hover'
          }`}
        >
          <Music className="w-3.5 h-3.5" />
          <span>Audio & Voice ({counts.audio})</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('file')}
          className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
            tab === 'file'
              ? 'bg-dc-accent text-white'
              : 'text-dc-text-muted hover:text-white hover:bg-dc-hover'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Files ({counts.file})</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full text-dc-text-muted text-sm">
            Loading channel media...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-dc-text-muted">
            <span className="text-2xl">⚠️</span>
            <span className="text-sm">{error}</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-dc-text-muted">
            <span className="text-3xl">🖼️</span>
            <span className="text-sm font-medium">No media found in this category.</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {filteredItems.map((item, idx) => {
              if (item.media_type === 'image') {
                return (
                  <GalleryImageItem
                    key={`${item.message_id}-${idx}`}
                    item={item}
                    onImageClick={onImageClick}
                    onOpenLink={handleOpenLink}
                    onLinkContextMenu={onLinkContextMenu}
                    onJumpToMessage={onJumpToMessage}
                  />
                );
              }

              if (item.media_type === 'video') {
                const finalUrl = getResolvedUrl(item.url);
                return (
                  <div
                    key={`${item.message_id}-${idx}`}
                    className="group relative aspect-square bg-dc-dark rounded-xl overflow-hidden border border-dc-input/40 hover:border-dc-accent/80 transition-all shadow-sm flex flex-col justify-between p-2"
                  >
                    <div className="flex-1 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-dc-accent/80 group-hover:bg-dc-accent text-white flex items-center justify-center shadow-lg transition-transform group-hover:scale-110">
                        <Film className="w-6 h-6" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 min-w-0 bg-dc-darker/90 p-2 rounded-lg">
                      <span className="text-[11px] font-semibold text-white truncate" title={item.filename}>
                        {item.filename}
                      </span>
                      <div className="flex items-center justify-between text-[10px] text-dc-text-muted">
                        <span className="truncate">{item.author}</span>
                        <span>{item.timestamp.slice(0, 10)}</span>
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <button
                          type="button"
                          onClick={e => handleOpenLink(e, finalUrl)}
                          className="flex-1 py-1 rounded bg-dc-dark hover:bg-dc-hover text-white text-[10px] font-medium transition-colors"
                        >
                          Play / Open
                        </button>
                        <button
                          type="button"
                          onClick={() => onJumpToMessage(item.message_id)}
                          className="flex-1 py-1 rounded bg-dc-accent/90 hover:bg-dc-accent text-white text-[10px] font-semibold transition-colors"
                        >
                          Jump
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              if (item.media_type === 'audio') {
                const finalUrl = getResolvedUrl(item.url);
                return (
                  <div
                    key={`${item.message_id}-${idx}`}
                    className="group relative aspect-square bg-dc-dark rounded-xl border border-dc-input/40 hover:border-dc-accent/80 transition-all shadow-sm flex flex-col justify-between p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xl">🎙️</span>
                      <button
                        type="button"
                        onClick={e => handleOpenLink(e, finalUrl)}
                        onContextMenu={e => onLinkContextMenu?.(e, finalUrl)}
                        className="text-dc-text-muted hover:text-white text-xs"
                        title="Open file"
                      >
                        🔗
                      </button>
                    </div>

                    <div className="flex-1 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-[#5865F2] text-white flex items-center justify-center shadow-lg transition-transform group-hover:scale-105">
                        <Music className="w-6 h-6" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 min-w-0 bg-dc-darker/90 p-2 rounded-lg">
                      <span className="text-[11px] font-semibold text-white truncate" title={item.filename}>
                        {item.filename}
                      </span>
                      <div className="flex items-center justify-between text-[10px] text-dc-text-muted">
                        <span className="truncate">{item.author}</span>
                        <span>{item.timestamp.slice(0, 10)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onJumpToMessage(item.message_id)}
                        className="mt-1 w-full py-1 rounded bg-dc-accent/90 hover:bg-dc-accent text-white text-[10px] font-semibold transition-colors"
                      >
                        Jump to Message
                      </button>
                    </div>
                  </div>
                );
              }

              const finalUrl = getResolvedUrl(item.url);
              return (
                <div
                  key={`${item.message_id}-${idx}`}
                  className="group relative aspect-square bg-dc-dark rounded-xl border border-dc-input/40 hover:border-dc-accent/80 transition-all shadow-sm flex flex-col justify-between p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-dc-accent/20 text-dc-accent border border-dc-accent/30 uppercase">
                      {item.filename.split('.').pop() || 'FILE'}
                    </span>
                    <button
                      type="button"
                      onClick={e => handleOpenLink(e, finalUrl)}
                      onContextMenu={e => onLinkContextMenu?.(e, finalUrl)}
                      className="text-dc-text-muted hover:text-white text-xs"
                      title="Open file"
                    >
                      🔗
                    </button>
                  </div>

                  <div className="flex-1 flex items-center justify-center">
                    <FileText className="w-10 h-10 text-dc-text-muted group-hover:text-white transition-colors" />
                  </div>

                  <div className="flex flex-col gap-1 min-w-0 bg-dc-darker/90 p-2 rounded-lg">
                    <span className="text-[11px] font-semibold text-white truncate" title={item.filename}>
                      {item.filename}
                    </span>
                    <div className="flex items-center justify-between text-[10px] text-dc-text-muted">
                      <span className="truncate">{item.author}</span>
                      <span>{item.timestamp.slice(0, 10)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onJumpToMessage(item.message_id)}
                      className="mt-1 w-full py-1 rounded bg-dc-accent/90 hover:bg-dc-accent text-white text-[10px] font-semibold transition-colors"
                    >
                      Jump to Message
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {toast && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-dc-dark text-white text-xs px-4 py-2.5 rounded-md shadow-2xl border border-dc-input flex items-center gap-2 select-none pointer-events-none">
          <span className="text-dc-green font-bold">✓</span>
          <span className="font-medium">{toast}</span>
        </div>
      )}
    </div>
  );
}
