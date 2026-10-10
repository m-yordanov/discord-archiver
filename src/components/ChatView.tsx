import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { save } from '@tauri-apps/plugin-dialog';
import { ChannelInfo, ExportResult, Message, MessageJump, MessagesResponse, SearchResponse } from '../types';
import { MessageItem } from './MessageItem';
import { ImageModal } from './ImageModal';
import { JsonModal } from './JsonModal';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { SearchFilters } from './SearchFilters';
import { EMPTY_FILTERS, MessageFilters, applyFilters, countActiveFilters } from '../filters';
import { isAudio } from '../attachments';
import { Download, Image as ImageIcon, Settings as SettingsIcon } from 'lucide-react';
import { MediaGallery } from './MediaGallery';
import { useSettings } from '../settings';

const PAGE_SIZE = 500;

type ExportFormat = 'html' | 'text' | 'json';

const EXPORT_FORMATS: { format: ExportFormat; label: string; extension: string }[] = [
  { format: 'html', label: 'Export as HTML', extension: 'html' },
  { format: 'text', label: 'Export as Text', extension: 'txt' },
  { format: 'json', label: 'Export as JSON', extension: 'json' },
];

const shouldShowHeader = (currentMsg: Message, prevMsg: Message | null) => {
  if (!prevMsg) return true;
  if (currentMsg.message_reference) return true;
  if (currentMsg.author !== prevMsg.author) return true;

  const currentT = new Date(currentMsg.timestamp.replace(' ', 'T')).getTime();
  const prevT = new Date(prevMsg.timestamp.replace(' ', 'T')).getTime();
  return currentT - prevT > 7 * 60 * 1000;
};

const SEARCH_NAV_BUTTON =
  'px-1 py-0.5 hover:bg-dc-hover rounded text-dc-text-muted hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-default';

const toggleButtonClass = (active: boolean) =>
  `px-2 py-1 rounded text-xs transition-colors cursor-pointer border ${
    active
      ? 'bg-dc-accent text-white border-dc-accent'
      : 'bg-dc-dark text-dc-text-muted hover:text-white border-dc-input/60'
  }`;

function LoadMoreButton({ onClick, busy, label }: { onClick: () => void; busy: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="px-3 py-1.5 rounded text-xs bg-dc-dark hover:bg-dc-hover text-dc-text border border-dc-input/60 transition-colors cursor-pointer disabled:opacity-50"
    >
      {label}
    </button>
  );
}

interface ChatViewProps {
  selectedChannel: ChannelInfo | null;
  dataPath: string | null;
  userMap: Record<string, string>;
  onOpenDmByUserId?: (userId: string) => boolean;
  onOpenChannelById?: (channelId: string) => boolean;
  onOpenSettings?: () => void;
  jumpTarget?: MessageJump | null;
}

export function ChatView({
  selectedChannel,
  dataPath,
  userMap,
  onOpenDmByUserId,
  onOpenChannelById,
  onOpenSettings,
  jumpTarget = null,
}: ChatViewProps) {
  const { timeFormat } = useSettings();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const [loadedOffset, setLoadedOffset] = useState<number>(0);
  const [totalMessages, setTotalMessages] = useState<number>(0);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [rawJson, setRawJson] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<MessageFilters>(EMPTY_FILTERS);
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);
  const [currentMatchIdx, setCurrentMatchIdx] = useState<number>(0);
  const [isSearching, setIsSearching] = useState(false);
  const [showResultsPanel, setShowResultsPanel] = useState(false);
  const [toast, setToast] = useState<{ text: string; success: boolean } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'chat' | 'media'>('chat');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const shouldScrollToBottomRef = useRef(true);
  const highlightTimerRef = useRef<number | null>(null);
  const activeChannelRef = useRef(selectedChannel);
  activeChannelRef.current = selectedChannel;
  const jumpTargetRef = useRef(jumpTarget);
  jumpTargetRef.current = jumpTarget;
  const handledJumpRef = useRef<number | null>(null);

  const searchResults = searchResponse?.matches ?? [];
  const totalSearchMatches = searchResponse?.total_matches ?? 0;

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const showToast = useCallback((text: string, success = false) => {
    setToast({ text, success });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const openMenu = useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  const fetchPage = useCallback(
    (channel: ChannelInfo, offset: number | null, limit: number) =>
      invoke<MessagesResponse>('get_messages', {
        dataPath,
        folderNames: channel.folder_names,
        limit,
        offset,
      }),
    [dataPath]
  );

  const applyWindow = useCallback((response: MessagesResponse, offset: number | null) => {
    setMessages(response.messages);
    setTotalMessages(response.total);
    setLoadedOffset(offset ?? Math.max(0, response.total - response.messages.length));
  }, []);

  const hasMoreOlder = loadedOffset > 0;
  const hasMoreNewer = loadedOffset + messages.length < totalMessages;

  useEffect(() => {
    setFilters(EMPTY_FILTERS);
    setSearchResponse(null);
    setCurrentMatchIdx(0);
    setViewMode('chat');
    setScrollTarget(null);

    if (!selectedChannel || !dataPath) {
      setMessages([]);
      setTotalMessages(0);
      setLoadedOffset(0);
      setSearchQuery('');
      return;
    }

    const pending = jumpTargetRef.current;
    const jump =
      pending && pending.channelId === selectedChannel.id && handledJumpRef.current !== pending.nonce
        ? pending
        : null;
    if (jump) handledJumpRef.current = jump.nonce;
    const offset = jump ? Math.max(0, jump.totalIndex - Math.floor(PAGE_SIZE / 2)) : null;

    shouldScrollToBottomRef.current = !jump;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    fetchPage(selectedChannel, offset, PAGE_SIZE)
      .then(response => {
        if (cancelled) return;
        applyWindow(response, offset);
        if (jump) setScrollTarget(jump.messageId);
      })
      .catch(e => {
        if (cancelled) return;
        applyWindow({ messages: [], total: 0 }, 0);
        setLoadError(typeof e === 'string' ? e : 'Could not read this channel.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedChannel, dataPath]);

  const loadWindow = useCallback(
    async (offset: number | null, failure: string, onLoaded: () => void) => {
      if (!selectedChannel) return;
      const channel = selectedChannel;
      setLoading(true);
      try {
        const response = await fetchPage(channel, offset, PAGE_SIZE);
        if (activeChannelRef.current !== channel) return;
        applyWindow(response, offset);
        onLoaded();
      } catch {
        if (activeChannelRef.current === channel) showToast(failure);
      } finally {
        if (activeChannelRef.current === channel) setLoading(false);
      }
    },
    [selectedChannel, fetchPage, applyWindow, showToast]
  );

  const showMessage = useCallback(
    (messageId: string, totalIndex: number, failure: string) => {
      if (messages.some(m => m.id === messageId)) {
        setScrollTarget(messageId);
        return;
      }
      const offset = Math.max(0, totalIndex - Math.floor(PAGE_SIZE / 2));
      loadWindow(offset, failure, () => setScrollTarget(messageId));
    },
    [messages, loadWindow]
  );

  useEffect(() => {
    const target = jumpTarget;
    if (!target || !selectedChannel || !dataPath) return;
    if (target.channelId !== selectedChannel.id || handledJumpRef.current === target.nonce) return;
    handledJumpRef.current = target.nonce;

    setViewMode('chat');
    showMessage(target.messageId, target.totalIndex, 'Could not load messages around this result');
  }, [jumpTarget]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || loading || !hasMoreOlder || !selectedChannel) return;

    const channel = selectedChannel;
    setLoadingOlder(true);
    const fetchLimit = Math.min(PAGE_SIZE, loadedOffset);
    const fetchOffset = loadedOffset - fetchLimit;

    try {
      const scrollEl = scrollRef.current;
      const prevScrollHeight = scrollEl ? scrollEl.scrollHeight : 0;
      const prevScrollTop = scrollEl ? scrollEl.scrollTop : 0;

      const response = await fetchPage(channel, fetchOffset, fetchLimit);
      if (activeChannelRef.current !== channel) return;

      setMessages(prev => [...response.messages, ...prev]);
      setLoadedOffset(fetchOffset);
      setTotalMessages(response.total);

      requestAnimationFrame(() => {
        if (scrollRef.current) {
          const newScrollHeight = scrollRef.current.scrollHeight;
          scrollRef.current.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
        }
      });
    } catch {
      if (activeChannelRef.current === channel) showToast('Could not load older messages');
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, loading, hasMoreOlder, selectedChannel, loadedOffset, fetchPage, showToast]);

  const loadNewerMessages = useCallback(async () => {
    if (loadingNewer || loading || !hasMoreNewer || !selectedChannel) return;

    const channel = selectedChannel;
    setLoadingNewer(true);
    const currentEnd = loadedOffset + messages.length;

    try {
      const response = await fetchPage(channel, currentEnd, Math.min(PAGE_SIZE, totalMessages - currentEnd));
      if (activeChannelRef.current !== channel) return;

      setMessages(prev => [...prev, ...response.messages]);
      setTotalMessages(response.total);
    } catch {
      if (activeChannelRef.current === channel) showToast('Could not load newer messages');
    } finally {
      setLoadingNewer(false);
    }
  }, [loadingNewer, loading, hasMoreNewer, selectedChannel, loadedOffset, messages.length, totalMessages, fetchPage, showToast]);

  const jumpToPresent = useCallback(() => {
    loadWindow(null, 'Could not jump to present', () => {
      shouldScrollToBottomRef.current = true;
    });
  }, [loadWindow]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < 120 && hasMoreOlder && !loadingOlder && !loading) {
      loadOlderMessages();
    } else if (
      el.scrollHeight - el.scrollTop - el.clientHeight < 120 &&
      hasMoreNewer &&
      !loadingNewer &&
      !loading
    ) {
      loadNewerMessages();
    }
  }, [hasMoreOlder, hasMoreNewer, loadingOlder, loadingNewer, loading, loadOlderMessages, loadNewerMessages]);

  const filteredMessages = useMemo(() => applyFilters(messages, filters), [messages, filters]);
  const activeFilterCount = countActiveFilters(filters);

  const messageMap = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) {
      map.set(m.id, m);
    }
    return map;
  }, [messages]);

  const virtualizer = useVirtualizer({
    count: filteredMessages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 10,
    getItemKey: index => filteredMessages[index]?.id ?? String(index),
  });

  useEffect(() => {
    if (!scrollTarget || loading) return;
    const index = filteredMessages.findIndex(m => m.id === scrollTarget);
    if (index === -1) {
      if (activeFilterCount > 0 && messages.some(m => m.id === scrollTarget)) setFilters(EMPTY_FILTERS);
      return;
    }

    setScrollTarget(null);
    virtualizer.scrollToIndex(index, { align: 'center' });
    const frame = requestAnimationFrame(() => virtualizer.scrollToIndex(index, { align: 'center' }));
    setHighlightedMessageId(scrollTarget);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightedMessageId(null), 2000);
    return () => cancelAnimationFrame(frame);
  }, [scrollTarget, loading, filteredMessages, messages, activeFilterCount, virtualizer]);

  useEffect(() => {
    if (searchQuery || filteredMessages.length === 0) return;
    if (!shouldScrollToBottomRef.current) return;

    shouldScrollToBottomRef.current = false;
    const last = filteredMessages.length - 1;
    virtualizer.scrollToIndex(last, { align: 'end' });
    const frame = requestAnimationFrame(() => virtualizer.scrollToIndex(last, { align: 'end' }));
    return () => cancelAnimationFrame(frame);
  }, [filteredMessages, searchQuery, virtualizer]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed || !selectedChannel || !dataPath) {
      setSearchResponse(null);
      setCurrentMatchIdx(0);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response: SearchResponse = await invoke('search_channel_messages', {
          dataPath,
          folderNames: selectedChannel.folder_names,
          query: trimmed,
          dateMode: filters.dateMode || null,
          dateFrom: filters.dateFrom || null,
          dateTo: filters.dateTo || null,
          attachmentMode: filters.attachment || null,
          limit: 500,
        });
        if (cancelled) return;

        setSearchResponse(response);
        const lastIdx = response.matches.length - 1;
        setCurrentMatchIdx(Math.max(0, lastIdx));
        if (lastIdx >= 0) {
          const latest = response.matches[lastIdx];
          showMessage(latest.message.id, latest.total_index, 'Could not load messages around this result');
        }
      } catch {
        if (cancelled) return;
        setSearchResponse(null);
        setCurrentMatchIdx(0);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    searchQuery,
    filters.dateMode,
    filters.dateFrom,
    filters.dateTo,
    filters.attachment,
    selectedChannel,
    dataPath,
  ]);

  const jumpToMatch = useCallback(
    (idxInMatches: number) => {
      if (searchResults.length === 0) return;
      const boundedIdx = (idxInMatches + searchResults.length) % searchResults.length;
      setCurrentMatchIdx(boundedIdx);

      const match = searchResults[boundedIdx];
      showMessage(match.message.id, match.total_index, 'Could not load messages around this result');
    },
    [searchResults, showMessage]
  );

  const handleJumpToMessage = useCallback(
    async (messageId: string) => {
      if (messages.some(m => m.id === messageId)) {
        setScrollTarget(messageId);
        return;
      }
      if (!dataPath || !selectedChannel) return;

      const channel = selectedChannel;
      const failure = `Could not load referenced message (${messageId})`;
      try {
        const searchRes: SearchResponse = await invoke('search_channel_messages', {
          dataPath,
          folderNames: channel.folder_names,
          query: messageId,
          dateMode: null,
          dateFrom: null,
          dateTo: null,
          attachmentMode: null,
          limit: 1,
        });
        if (activeChannelRef.current !== channel) return;

        const match = searchRes.matches.find(m => m.message.id === messageId);
        if (!match) {
          showToast(`Referenced message (${messageId}) was not found in this archive`);
          return;
        }
        showMessage(messageId, match.total_index, failure);
      } catch {
        if (activeChannelRef.current === channel) showToast(failure);
      }
    },
    [messages, dataPath, selectedChannel, showMessage, showToast]
  );

  const handleReplyContextMenu = useCallback(
    (e: React.MouseEvent, messageId: string) => {
      openMenu(e, [
        { label: 'Copy Referenced Message ID', value: messageId, badge: 'ID' },
        {
          label: 'Jump to Message',
          onClick: () => handleJumpToMessage(messageId),
        },
        {
          label: 'Search for Message ID',
          onClick: () => {
            setSearchQuery(messageId);
            setShowResultsPanel(true);
          },
        },
      ]);
    },
    [openMenu, handleJumpToMessage]
  );

  const handleMessageContextMenu = useCallback(
    (e: React.MouseEvent, message: Message) => {
      const items: ContextMenuItem[] = [];

      if (message.author_id) {
        items.push({ label: 'Copy User ID', value: message.author_id, badge: 'ID' });
      }

      items.push({ label: 'Copy Message ID', value: message.id });

      if (dataPath && selectedChannel) {
        items.push({
          label: 'View Raw Data',
          onClick: async () => {
            try {
              const json: string = await invoke('get_raw_message', {
                dataPath,
                folderNames: selectedChannel.folder_names,
                messageId: message.id,
              });
              setRawJson(json);
            } catch {
              showToast('Could not load raw data for this message');
            }
          },
        });
      }

      openMenu(e, items);
    },
    [dataPath, selectedChannel, openMenu, showToast]
  );

  const handleMentionClick = useCallback(
    (userId: string) => {
      const found = onOpenDmByUserId?.(userId);
      if (!found) showToast('No DM found for this user');
    },
    [onOpenDmByUserId, showToast]
  );

  const handleMentionContextMenu = useCallback(
    (e: React.MouseEvent, userId: string, username?: string) => {
      openMenu(e, [
        { label: 'Copy User ID', value: userId, badge: 'ID' },
        ...(username ? [{ label: 'Copy Username', value: username }] : []),
        { label: 'Open Direct Message', onClick: () => handleMentionClick(userId) },
      ]);
    },
    [openMenu, handleMentionClick]
  );

  const handleChannelClick = useCallback(
    (channelId: string) => {
      const found = onOpenChannelById?.(channelId);
      if (!found) showToast('Channel not found in this archive');
    },
    [onOpenChannelById, showToast]
  );

  const handleChannelContextMenu = useCallback(
    (e: React.MouseEvent, channelId: string, channelName?: string) => {
      openMenu(e, [
        { label: 'Copy Channel ID', value: channelId, badge: 'ID' },
        ...(channelName ? [{ label: 'Copy Channel Name', value: channelName }] : []),
        { label: 'Open Channel', onClick: () => handleChannelClick(channelId) },
      ]);
    },
    [openMenu, handleChannelClick]
  );

  const handleLinkContextMenu = useCallback(
    (e: React.MouseEvent, url: string) => {
      e.preventDefault();
      e.stopPropagation();

      openMenu(e, [
        { label: 'Copy Link', value: url },
        {
          label: 'Open Link in Browser',
          onClick: () => {
            openUrl(url).catch(err => {
              console.error('Failed to open link:', err);
              window.open(url, '_blank');
            });
          },
        },
      ]);
    },
    [openMenu]
  );

  const exportConversation = async (format: ExportFormat, extension: string) => {
    if (!selectedChannel || isExporting) return;
    const channel = selectedChannel;
    const isDm = channel.channel_type === 'DM' || channel.channel_type === 'GROUP_DM';
    const name = channel.name || 'conversation';

    const savePath = await save({
      defaultPath: `${name.replace(/[\\/:*?"<>|]/g, '_')}.${extension}`,
      filters: [{ name: format.toUpperCase(), extensions: [extension] }],
    });
    if (!savePath) return;

    setIsExporting(true);
    try {
      const result = await invoke<ExportResult>('export_conversation', {
        dataPath,
        folderNames: channel.folder_names,
        format,
        title: `${isDm ? '@' : '#'}${name}`,
        savePath,
      });
      const mb = result.total_bytes / (1024 * 1024);
      const size =
        mb < 0.1
          ? `${(result.total_bytes / 1024).toFixed(1)} KB`
          : `${mb.toFixed(1)} MB`;
      showToast(`Exported ${result.count.toLocaleString()} messages (${size})`, true);
    } catch (e) {
      showToast(typeof e === 'string' ? e : 'Could not export this conversation');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportMenu = (e: React.MouseEvent) => {
    openMenu(
      e,
      EXPORT_FORMATS.map(({ format, label, extension }) => ({
        label,
        onClick: () => exportConversation(format, extension),
      }))
    );
  };

  const clearSearch = () => {
    setSearchQuery('');
    setShowResultsPanel(false);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      jumpToMatch(e.shiftKey ? currentMatchIdx - 1 : currentMatchIdx + 1);
    } else if (e.key === 'Escape') {
      clearSearch();
      searchInputRef.current?.blur();
    }
  };

  if (!selectedChannel) {
    return (
      <div className="flex-1 bg-dc-darkest flex items-center justify-center text-dc-text-muted">
        Select a channel to view messages
      </div>
    );
  }

  const isDMs = selectedChannel.channel_type === 'DM' || selectedChannel.channel_type === 'GROUP_DM';
  const prefix = isDMs ? '@' : '#';
  const currentMatchedMessageId = searchResults[currentMatchIdx]?.message.id ?? null;
  const totalCountDisplay = totalMessages > 0 ? totalMessages : selectedChannel.message_count;

  return (
    <div className="flex-1 bg-dc-darkest flex flex-col min-w-0 h-full relative">
      <div className="h-12 flex items-center justify-between px-4 border-b border-dc-dark shrink-0 gap-3">
        <div className="flex items-center min-w-0">
          <span className="text-xl text-dc-text-muted mr-2 leading-none">{prefix}</span>
          <span className="font-bold text-white mr-4 truncate">{selectedChannel.name || 'Unknown Channel'}</span>
          <div className="w-[1px] h-6 bg-dc-divider mr-4 shrink-0" />
          <span className="text-sm text-dc-text-muted shrink-0">
            {activeFilterCount > 0
              ? `${filteredMessages.length.toLocaleString()} of ${messages.length.toLocaleString()} loaded messages (${totalCountDisplay.toLocaleString()} total)`
              : `${totalCountDisplay.toLocaleString()} messages`}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="relative flex items-center bg-dc-dark rounded px-2.5 py-1 text-xs text-dc-text border border-dc-input/60 focus-within:border-dc-accent transition-colors">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={`Search ${selectedChannel.name || 'conversation'}`}
              title={`Search ${selectedChannel.name || 'conversation'} (Ctrl+F)`}
              className="bg-transparent border-none outline-none text-white text-xs w-48 placeholder:text-dc-text-muted"
            />
            {searchQuery && (
              <div className="flex items-center gap-1 ml-1 select-none">
                <span className="text-[11px] text-dc-text-muted font-medium mr-1">
                  {isSearching
                    ? 'Searching...'
                    : totalSearchMatches > 0
                    ? `${currentMatchIdx + 1}/${totalSearchMatches}`
                    : '0 results'}
                </span>
                <button
                  type="button"
                  onClick={() => jumpToMatch(currentMatchIdx - 1)}
                  disabled={searchResults.length === 0}
                  title="Previous match (Shift+Enter)"
                  className={`${SEARCH_NAV_BUTTON} text-[10px]`}
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => jumpToMatch(currentMatchIdx + 1)}
                  disabled={searchResults.length === 0}
                  title="Next match (Enter)"
                  className={`${SEARCH_NAV_BUTTON} text-[10px]`}
                >
                  ▼
                </button>
                <button
                  type="button"
                  onClick={clearSearch}
                  title="Clear search (Esc)"
                  className={`${SEARCH_NAV_BUTTON} text-xs`}
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          <SearchFilters
            filters={filters}
            onChange={setFilters}
            shownCount={filteredMessages.length}
            totalCount={messages.length}
          />

          <button
            type="button"
            onClick={() => setViewMode(prev => (prev === 'media' ? 'chat' : 'media'))}
            className={`${toggleButtonClass(viewMode === 'media')} flex items-center gap-1.5`}
            title={viewMode === 'media' ? 'Back to Messages' : 'View Photos, Videos & Files'}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Media</span>
          </button>

          <button
            type="button"
            onClick={handleExportMenu}
            disabled={isExporting}
            className={`${toggleButtonClass(false)} flex items-center gap-1.5 disabled:opacity-50`}
            title="Export this conversation as HTML, text or JSON"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isExporting ? 'Exporting…' : 'Export'}</span>
          </button>

          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="p-1 rounded text-xs transition-colors cursor-pointer border bg-dc-dark text-dc-text-muted hover:text-white border-dc-input/60 hover:bg-dc-hover"
              title="Settings (Ctrl+,)"
            >
              <SettingsIcon className="w-3.5 h-3.5" />
            </button>
          )}

          {searchQuery && searchResults.length > 0 && (
            <button
              type="button"
              onClick={() => setShowResultsPanel(!showResultsPanel)}
              title={showResultsPanel ? 'Hide search results list' : 'Show all search results list'}
              className={toggleButtonClass(showResultsPanel)}
            >
              List ({totalSearchMatches})
            </button>
          )}
        </div>
      </div>

      {viewMode === 'media' ? (
        <MediaGallery
          selectedChannel={selectedChannel}
          dataPath={dataPath}
          onClose={() => setViewMode('chat')}
          onJumpToMessage={messageId => {
            setViewMode('chat');
            handleJumpToMessage(messageId);
          }}
          onImageClick={setSelectedImage}
          onLinkContextMenu={handleLinkContextMenu}
        />
      ) : (
        <div className="flex-1 flex min-h-0 overflow-hidden relative">
        <div className="flex-1 overflow-y-auto p-4" ref={scrollRef} onScroll={handleScroll}>
          {loading ? (
            <div className="flex items-center justify-center h-full text-dc-text-muted">
              Loading messages...
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-dc-text-muted">
              <span className="text-2xl">⚠️</span>
              <span className="text-sm">{loadError}</span>
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-dc-text-muted">
              <span className="text-2xl">🔍</span>
              <span className="text-sm">
                {activeFilterCount > 0 ? 'No messages match these filters.' : 'No messages in this channel.'}
              </span>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  className="text-xs text-dc-text-link hover:underline cursor-pointer"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
              {virtualizer.getVirtualItems().map(item => {
                const msg = filteredMessages[item.index];
                if (!msg) return null;
                const prevMsg = item.index > 0 ? filteredMessages[item.index - 1] : null;
                const isLastItem = item.index === filteredMessages.length - 1;
                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    {item.index === 0 && (
                      hasMoreOlder ? (
                        <div className="flex justify-center pb-4">
                          <LoadMoreButton
                            onClick={loadOlderMessages}
                            busy={loadingOlder}
                            label={
                              loadingOlder
                                ? 'Loading older messages...'
                                : `Load older messages (${loadedOffset.toLocaleString()} remaining)`
                            }
                          />
                        </div>
                      ) : (
                        <div className="pt-4 pb-6 px-2 select-none">
                          <div className="w-14 h-14 rounded-full bg-dc-input flex items-center justify-center text-2xl text-white mb-2">
                            {prefix}
                          </div>
                          <h2 className="text-xl font-bold text-white mb-1">
                            Welcome to {prefix}{selectedChannel.name || 'this channel'}!
                          </h2>
                          <p className="text-xs text-dc-text-muted">
                            This is the start of the {prefix}{selectedChannel.name || 'conversation'} channel.
                          </p>
                          <div className="w-full h-[1px] bg-dc-divider mt-4" />
                        </div>
                      )
                    )}
                    <MessageItem
                      message={msg}
                      showHeader={shouldShowHeader(msg, prevMsg)}
                      searchQuery={searchQuery}
                      isCurrentMatch={currentMatchedMessageId === msg.id}
                      isHighlighted={highlightedMessageId === msg.id}
                      referencedMessage={msg.message_reference ? messageMap.get(msg.message_reference.message_id) : undefined}
                      selectedChannel={selectedChannel}
                      userMap={userMap}
                      onImageClick={setSelectedImage}
                      onContextMenu={handleMessageContextMenu}
                      onMentionClick={handleMentionClick}
                      onMentionContextMenu={handleMentionContextMenu}
                      onChannelClick={handleChannelClick}
                      onChannelContextMenu={handleChannelContextMenu}
                      onLinkContextMenu={handleLinkContextMenu}
                      onJumpToMessage={handleJumpToMessage}
                      onReplyContextMenu={handleReplyContextMenu}
                      timeFormat={timeFormat}
                    />
                    {isLastItem && hasMoreNewer && (
                      <div className="flex justify-center pt-4 pb-2">
                        <LoadMoreButton
                          onClick={loadNewerMessages}
                          busy={loadingNewer}
                          label={
                            loadingNewer
                              ? 'Loading newer messages...'
                              : `Load newer messages (${(totalMessages - (loadedOffset + messages.length)).toLocaleString()} remaining)`
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {hasMoreNewer && (
          <div className="absolute bottom-4 right-6 z-30">
            <button
              type="button"
              onClick={jumpToPresent}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-dc-accent hover:bg-dc-accent-hover text-white text-xs font-semibold shadow-xl transition-all hover:scale-105 cursor-pointer"
              title="Jump to the latest messages in this channel"
            >
              <span>Jump to Present</span>
              <span>↓</span>
            </button>
          </div>
        )}

        {showResultsPanel && searchQuery && searchResults.length > 0 && (
          <div className="w-72 bg-dc-dark border-l border-dc-divider flex flex-col shrink-0 select-none">
            <div className="h-10 px-3 flex items-center justify-between border-b border-dc-divider text-xs font-semibold text-white">
              <span>
                {totalSearchMatches} Result{totalSearchMatches === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={() => setShowResultsPanel(false)}
                className="text-dc-text-muted hover:text-white text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
              {searchResults.map((matchItem, matchIdx) => {
                const m = matchItem.message;
                const isSelected = matchIdx === currentMatchIdx;
                return (
                  <button
                    key={`${m.id}-${matchIdx}`}
                    type="button"
                    onClick={() => jumpToMatch(matchIdx)}
                    className={`p-2 rounded text-left text-xs transition-colors cursor-pointer border ${
                      isSelected
                        ? 'bg-dc-accent/20 border-dc-accent text-white'
                        : 'bg-dc-darkest/60 border-transparent hover:bg-dc-hover text-dc-text'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-dc-text-muted mb-1">
                      <span className="font-semibold text-white truncate max-w-[120px]">{m.author}</span>
                      <span className="shrink-0">{m.timestamp.slice(0, 10)}</span>
                    </div>
                    <div className="line-clamp-2 text-dc-text break-words">
                      {m.contents ||
                        (m.message_type === 'VOICE_MESSAGE' || m.attachments.some(isAudio)
                          ? '[Voice Message]'
                          : m.attachments.length > 0
                          ? '[Attachment]'
                          : m.stickers.length > 0
                          ? '[Sticker]'
                          : '[Message]')}
                    </div>
                  </button>
                );
              })}
              {totalSearchMatches > searchResults.length && (
                <div className="text-[11px] text-dc-text-muted text-center py-2">
                  Showing first {searchResults.length}. Use ▲▼ to reach the rest.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      <ImageModal
        imageUrl={selectedImage}
        onClose={() => setSelectedImage(null)}
      />

      <JsonModal rawJson={rawJson} onClose={() => setRawJson(null)} />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {toast && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-dc-dark text-white text-xs px-4 py-2.5 rounded-md shadow-2xl border border-dc-input flex items-center gap-2 select-none pointer-events-none">
          {toast.success ? (
            <span className="text-dc-green font-bold">✓</span>
          ) : (
            <span className="text-amber-400">⚠️</span>
          )}
          <span className="font-medium">{toast.text}</span>
        </div>
      )}
    </div>
  );
}
