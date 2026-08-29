import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { invoke } from '@tauri-apps/api/core';
import { ChannelInfo, Message } from '../types';
import { MessageItem } from './MessageItem';
import { ImageModal } from './ImageModal';
import { JsonModal } from './JsonModal';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { SearchFilters } from './SearchFilters';
import { EMPTY_FILTERS, MessageFilters, applyFilters, countActiveFilters } from '../filters';

const RESULTS_PANEL_LIMIT = 200;

const shouldShowHeader = (currentMsg: Message, prevMsg: Message | null) => {
  if (!prevMsg) return true;
  if (currentMsg.author !== prevMsg.author) return true;

  const currentT = new Date(currentMsg.timestamp.replace(' ', 'T')).getTime();
  const prevT = new Date(prevMsg.timestamp.replace(' ', 'T')).getTime();
  return currentT - prevT > 7 * 60 * 1000;
};

interface ChatViewProps {
  selectedChannel: ChannelInfo | null;
  dataPath: string | null;
  userMap: Record<string, string>;
  onOpenDmByUserId?: (userId: string) => boolean;
  onOpenChannelById?: (channelId: string) => boolean;
}

export function ChatView({
  selectedChannel,
  dataPath,
  userMap,
  onOpenDmByUserId,
  onOpenChannelById,
}: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [rawJson, setRawJson] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<MessageFilters>(EMPTY_FILTERS);
  const [currentMatchIdx, setCurrentMatchIdx] = useState<number>(0);
  const [showResultsPanel, setShowResultsPanel] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((text: string) => {
    setToastMessage(text);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  useEffect(() => {
    if (!selectedChannel || !dataPath) {
      setMessages([]);
      setSearchQuery('');
      setFilters(EMPTY_FILTERS);
      setCurrentMatchIdx(0);
      return;
    }

    const loadMessages = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const response: { messages: Message[]; total: number } = await invoke('get_messages', {
          dataPath,
          folderName: selectedChannel.folder_name,
          page: 0,
          pageSize: 0,
        });

        setMessages(response.messages);
      } catch (e) {
        setMessages([]);
        setLoadError(typeof e === 'string' ? e : 'Could not read this channel.');
      } finally {
        setLoading(false);
      }
    };

    loadMessages();
    setFilters(EMPTY_FILTERS);
  }, [selectedChannel, dataPath]);

  const filteredMessages = useMemo(() => applyFilters(messages, filters), [messages, filters]);
  const activeFilterCount = countActiveFilters(filters);

  const virtualizer = useVirtualizer({
    count: filteredMessages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 10,
    getItemKey: index => filteredMessages[index]?.id ?? String(index),
  });

  useEffect(() => {
    if (searchQuery || filteredMessages.length === 0) return;

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

  const matchingIndices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const matches = (msg: Message) =>
      msg.contents.toLowerCase().includes(q) ||
      msg.id.includes(q) ||
      msg.attachments.some(a => a.toLowerCase().includes(q)) ||
      msg.stickers.some(s => s.name.toLowerCase().includes(q) || s.id.includes(q)) ||
      msg.embeds.some(e =>
        [e.title, e.description, e.provider_name].some(
          field => field !== null && field.toLowerCase().includes(q)
        )
      );

    const indices: number[] = [];
    filteredMessages.forEach((msg, idx) => {
      if (matches(msg)) indices.push(idx);
    });
    return indices;
  }, [filteredMessages, searchQuery]);

  useEffect(() => {
    if (matchingIndices.length === 0) {
      setCurrentMatchIdx(0);
      return;
    }
    const last = matchingIndices.length - 1;
    setCurrentMatchIdx(last);
    virtualizer.scrollToIndex(matchingIndices[last], { align: 'center' });
  }, [matchingIndices, virtualizer]);

  const jumpToMatch = useCallback((idxInMatches: number) => {
    if (matchingIndices.length === 0) return;
    const boundedIdx = (idxInMatches + matchingIndices.length) % matchingIndices.length;
    setCurrentMatchIdx(boundedIdx);
    virtualizer.scrollToIndex(matchingIndices[boundedIdx], { align: 'center' });
  }, [matchingIndices, virtualizer]);

  const handleMessageContextMenu = useCallback((e: React.MouseEvent, message: Message) => {
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
              folderName: selectedChannel.folder_name,
              messageId: message.id,
            });
            setRawJson(json);
          } catch {
            showToast('Could not load raw data for this message');
          }
        },
      });
    }

    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, [dataPath, selectedChannel, showToast]);

  const handleMentionContextMenu = useCallback((e: React.MouseEvent, userId: string, username?: string) => {
    const items: ContextMenuItem[] = [
      { label: 'Copy User ID', value: userId, badge: 'ID' },
    ];

    if (username) {
      items.push({ label: 'Copy Username', value: username });
    }

    items.push({
      label: 'Open Direct Message',
      onClick: () => {
        const found = onOpenDmByUserId?.(userId);
        if (!found) showToast('No DM found for this user');
      },
    });

    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, [onOpenDmByUserId, showToast]);

  const handleMentionClick = useCallback((userId: string) => {
    const found = onOpenDmByUserId?.(userId);
    if (!found) showToast('No DM found for this user');
  }, [onOpenDmByUserId, showToast]);

  const handleChannelClick = useCallback((channelId: string) => {
    const found = onOpenChannelById?.(channelId);
    if (!found) showToast('Channel not found in this archive');
  }, [onOpenChannelById, showToast]);

  const handleChannelContextMenu = useCallback((e: React.MouseEvent, channelId: string, channelName?: string) => {
    const items: ContextMenuItem[] = [
      { label: 'Copy Channel ID', value: channelId, badge: 'ID' },
    ];

    if (channelName) {
      items.push({ label: 'Copy Channel Name', value: channelName });
    }

    items.push({
      label: 'Open Channel',
      onClick: () => {
        const found = onOpenChannelById?.(channelId);
        if (!found) showToast('Channel not found in this archive');
      },
    });

    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, [onOpenChannelById, showToast]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      jumpToMatch(e.shiftKey ? currentMatchIdx - 1 : currentMatchIdx + 1);
    } else if (e.key === 'Escape') {
      setSearchQuery('');
      setShowResultsPanel(false);
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
  const currentMatchedMessageId =
    matchingIndices.length > 0 ? filteredMessages[matchingIndices[currentMatchIdx]]?.id : null;
  const visibleResults = matchingIndices.slice(0, RESULTS_PANEL_LIMIT);

  return (
    <div className="flex-1 bg-dc-darkest flex flex-col min-w-0 h-full relative">
      <div className="h-12 flex items-center justify-between px-4 border-b border-dc-dark shrink-0 gap-3">
        <div className="flex items-center min-w-0">
          <span className="text-xl text-dc-text-muted mr-2 leading-none">{prefix}</span>
          <span className="font-bold text-white mr-4 truncate">{selectedChannel.name || 'Unknown Channel'}</span>
          <div className="w-[1px] h-6 bg-dc-divider mr-4 shrink-0" />
          <span className="text-sm text-dc-text-muted shrink-0">
            {activeFilterCount > 0
              ? `${filteredMessages.length.toLocaleString()} of ${messages.length.toLocaleString()} messages`
              : `${selectedChannel.message_count.toLocaleString()} messages`}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="relative flex items-center bg-dc-dark rounded px-2.5 py-1 text-xs text-dc-text border border-dc-input/60 focus-within:border-dc-accent transition-colors">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={`Search ${selectedChannel.name || 'conversation'}`}
              title={`Search ${selectedChannel.name || 'conversation'} (Ctrl+F)`}
              className="bg-transparent border-none outline-none text-white text-xs w-48 placeholder:text-dc-text-muted"
            />
            {searchQuery && (
              <div className="flex items-center gap-1 ml-1 select-none">
                <span className="text-[11px] text-dc-text-muted font-medium mr-1">
                  {matchingIndices.length > 0
                    ? `${currentMatchIdx + 1}/${matchingIndices.length}`
                    : '0 results'}
                </span>
                <button
                  type="button"
                  onClick={() => jumpToMatch(currentMatchIdx - 1)}
                  disabled={matchingIndices.length === 0}
                  title="Previous match (Shift+Enter)"
                  className="px-1 py-0.5 hover:bg-dc-hover rounded text-dc-text-muted hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-default text-[10px]"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => jumpToMatch(currentMatchIdx + 1)}
                  disabled={matchingIndices.length === 0}
                  title="Next match (Enter)"
                  className="px-1 py-0.5 hover:bg-dc-hover rounded text-dc-text-muted hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-default text-[10px]"
                >
                  ▼
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setShowResultsPanel(false);
                  }}
                  title="Clear search (Esc)"
                  className="px-1 py-0.5 hover:bg-dc-hover rounded text-dc-text-muted hover:text-white cursor-pointer text-xs"
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

          {searchQuery && matchingIndices.length > 0 && (
            <button
              type="button"
              onClick={() => setShowResultsPanel(!showResultsPanel)}
              title={showResultsPanel ? 'Hide search results list' : 'Show all search results list'}
              className={`px-2 py-1 rounded text-xs transition-colors cursor-pointer border ${
                showResultsPanel
                  ? 'bg-dc-accent text-white border-dc-accent'
                  : 'bg-dc-dark text-dc-text-muted hover:text-white border-dc-input/60'
              }`}
            >
              List ({matchingIndices.length})
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        <div className="flex-1 overflow-y-auto p-4" ref={scrollRef}>
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
                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    <MessageItem
                      message={msg}
                      showHeader={shouldShowHeader(msg, prevMsg)}
                      searchQuery={searchQuery}
                      isCurrentMatch={currentMatchedMessageId === msg.id}
                      userMap={userMap}
                      onImageClick={setSelectedImage}
                      onContextMenu={handleMessageContextMenu}
                      onMentionClick={handleMentionClick}
                      onMentionContextMenu={handleMentionContextMenu}
                      onChannelClick={handleChannelClick}
                      onChannelContextMenu={handleChannelContextMenu}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {showResultsPanel && searchQuery && matchingIndices.length > 0 && (
          <div className="w-72 bg-dc-dark border-l border-dc-divider flex flex-col shrink-0 select-none">
            <div className="h-10 px-3 flex items-center justify-between border-b border-dc-divider text-xs font-semibold text-white">
              <span>{matchingIndices.length} Results</span>
              <button
                type="button"
                onClick={() => setShowResultsPanel(false)}
                className="text-dc-text-muted hover:text-white text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
              {visibleResults.map((msgIdx, matchIdx) => {
                const m = filteredMessages[msgIdx];
                const isSelected = matchIdx === currentMatchIdx;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => jumpToMatch(matchIdx)}
                    className={`p-2 rounded text-left text-xs transition-colors cursor-pointer border ${
                      isSelected
                        ? 'bg-dc-accent/20 border-dc-accent text-white'
                        : 'bg-dc-darkest/60 border-transparent hover:bg-dc-hover text-dc-text'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-dc-text-muted mb-1">
                      <span className="font-semibold text-white">{m.author}</span>
                      <span>{m.timestamp}</span>
                    </div>
                    <div className="line-clamp-2 text-dc-text break-words">
                      {m.contents || (m.attachments.length > 0 ? '[Attachment]' : m.stickers.length > 0 ? '[Sticker]' : '[Message]')}
                    </div>
                  </button>
                );
              })}
              {matchingIndices.length > RESULTS_PANEL_LIMIT && (
                <div className="text-[11px] text-dc-text-muted text-center py-2">
                  Showing first {RESULTS_PANEL_LIMIT}. Use ▲▼ to reach the rest.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

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

      {toastMessage && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#202225] text-white text-xs px-4 py-2.5 rounded-md shadow-2xl border border-dc-input flex items-center gap-2 select-none pointer-events-none">
          <span className="text-amber-400">⚠️</span>
          <span className="font-medium">{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
