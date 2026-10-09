import { useState, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Search, MessageCircle, MessageSquare, Hash, X, ArrowRight, CornerDownLeft } from 'lucide-react';
import { DataIndex, ChannelInfo, GlobalSearchMatch, GlobalSearchResponse } from '../types';

type SearchMode = 'conversations' | 'messages';

const MESSAGE_RESULT_LIMIT = 200;

const snippetAround = (text: string, query: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) {
    return { before: flat.slice(0, 160), match: '', after: flat.length > 160 ? '…' : '' };
  }
  const start = Math.max(0, at - 50);
  const end = at + query.length;
  return {
    before: (start > 0 ? '…' : '') + flat.slice(start, at),
    match: flat.slice(at, end),
    after: flat.slice(end, end + 120) + (flat.length > end + 120 ? '…' : ''),
  };
};

const formatResultDate = (timestamp: string) =>
  new Date(timestamp.replace(' ', 'T')).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

interface SearchResult {
  id: string;
  type: 'dm' | 'channel';
  name: string;
  serverName?: string;
  serverId?: string;
  channel: ChannelInfo;
  messageCount: number;
  recipientId?: string;
}

interface ConversationSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  dataIndex: DataIndex;
  onSelectDm: (channel: ChannelInfo) => void;
  onSelectServerChannel: (serverId: string, channel: ChannelInfo) => void;
  onSelectMessage: (match: GlobalSearchMatch) => void;
}

export function ConversationSearchModal({
  isOpen,
  onClose,
  dataIndex,
  onSelectDm,
  onSelectServerChannel,
  onSelectMessage,
}: ConversationSearchModalProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterType, setFilterType] = useState<'all' | 'dms' | 'channels'>('all');
  const [mode, setMode] = useState<SearchMode>('conversations');
  const [messageResults, setMessageResults] = useState<GlobalSearchResponse | null>(null);
  const [isSearchingMessages, setIsSearchingMessages] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setFilterType('all');
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const allItems = useMemo<SearchResult[]>(() => {
    const items: SearchResult[] = [];

    for (const dm of dataIndex.direct_messages) {
      items.push({
        id: `dm-${dm.id || dm.folder_names[0] || 'dm'}`,
        type: 'dm',
        name: dm.name || 'Direct Message',
        channel: dm,
        messageCount: dm.message_count,
        recipientId: dm.recipient_id || undefined,
      });
    }

    for (const server of dataIndex.servers) {
      for (const channel of server.channels) {
        items.push({
          id: `channel-${channel.id}`,
          type: 'channel',
          name: channel.name || 'channel',
          serverName: server.name,
          serverId: server.id,
          channel,
          messageCount: channel.message_count,
        });
      }
    }

    return items;
  }, [dataIndex]);

  const filteredResults = useMemo(() => {
    const q = query.trim().toLowerCase();

    let items = allItems;
    if (filterType === 'dms') {
      items = items.filter(item => item.type === 'dm');
    } else if (filterType === 'channels') {
      items = items.filter(item => item.type === 'channel');
    }

    if (!q) {
      return [...items].sort((a, b) => b.messageCount - a.messageCount).slice(0, 30);
    }

    return items
      .filter(item => {
        const nameMatch = item.name.toLowerCase().includes(q);
        const serverMatch = item.serverName?.toLowerCase().includes(q);
        const recipientMatch = item.recipientId?.toLowerCase().includes(q);
        const idMatch = item.channel.id.toLowerCase().includes(q);
        const folderMatch = item.channel.folder_names.some(f => f.toLowerCase().includes(q));
        return nameMatch || serverMatch || recipientMatch || idMatch || folderMatch;
      })
      .sort((a, b) => {
        const aExact = a.name.toLowerCase() === q;
        const bExact = b.name.toLowerCase() === q;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        const aStarts = a.name.toLowerCase().startsWith(q);
        const bStarts = b.name.toLowerCase().startsWith(q);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        return b.messageCount - a.messageCount;
      })
      .slice(0, 40);
  }, [allItems, query, filterType]);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!isOpen || mode !== 'messages' || trimmedQuery.length < 2) {
      setMessageResults(null);
      setIsSearchingMessages(false);
      setMessageError(null);
      return;
    }

    let cancelled = false;
    setIsSearchingMessages(true);
    const timer = setTimeout(async () => {
      try {
        const response = await invoke<GlobalSearchResponse>('search_all_messages', {
          query: trimmedQuery,
          scope: filterType,
          limit: MESSAGE_RESULT_LIMIT,
        });
        if (cancelled) return;
        setMessageResults(response);
        setMessageError(null);
      } catch (e) {
        if (cancelled) return;
        setMessageResults(null);
        setMessageError(typeof e === 'string' ? e : 'Could not search messages.');
      } finally {
        if (!cancelled) setIsSearchingMessages(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, mode, trimmedQuery, filterType]);

  const messageMatches = messageResults?.matches ?? [];
  const resultCount = mode === 'messages' ? messageMatches.length : filteredResults.length;

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredResults, messageResults, mode]);

  useEffect(() => {
    if (resultsContainerRef.current) {
      const selectedEl = resultsContainerRef.current.children[selectedIndex] as HTMLElement | undefined;
      selectedEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleSelect = (item: SearchResult) => {
    if (item.type === 'dm') {
      onSelectDm(item.channel);
    } else if (item.serverId) {
      onSelectServerChannel(item.serverId, item.channel);
    }
    onClose();
  };

  const handleSelectMessage = (match: GlobalSearchMatch) => {
    onSelectMessage(match);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (resultCount > 0 ? (prev + 1) % resultCount : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (resultCount > 0 ? (prev - 1 + resultCount) % resultCount : 0));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setMode(prev => (prev === 'messages' ? 'conversations' : 'messages'));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'messages') {
        if (messageMatches[selectedIndex]) handleSelectMessage(messageMatches[selectedIndex]);
      } else if (filteredResults[selectedIndex]) {
        handleSelect(filteredResults[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-start justify-center pt-24 bg-black/60 backdrop-blur-xs select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] bg-dc-darker rounded-xl shadow-2xl border border-dc-input/60 overflow-hidden flex flex-col max-h-[520px] animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="p-3 border-b border-dc-dark flex items-center gap-2.5 bg-dc-dark">
          <Search size={18} className="text-dc-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === 'messages'
                ? 'Search messages in every conversation...'
                : 'Search conversations, servers, and DMs...'
            }
            className="flex-1 bg-transparent border-none outline-none text-white text-sm placeholder:text-dc-text-muted"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-dc-text-muted hover:text-white p-1 rounded cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="px-3 pt-1.5 flex items-center gap-4 text-xs bg-dc-dark border-b border-dc-dark">
          {(['conversations', 'messages'] as const).map(option => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setMode(option);
                inputRef.current?.focus();
              }}
              className={`pb-1.5 border-b-2 cursor-pointer transition-colors font-medium ${
                mode === option
                  ? 'border-dc-accent text-white'
                  : 'border-transparent text-dc-text-muted hover:text-white'
              }`}
            >
              {option === 'messages' ? 'Messages' : 'Conversations'}
            </button>
          ))}
        </div>

        <div className="px-3 py-1.5 border-b border-dc-dark flex items-center justify-between text-xs bg-dc-dark/40">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFilterType('all')}
              className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                filterType === 'all'
                  ? 'bg-dc-accent text-white font-medium'
                  : 'text-dc-text-muted hover:text-white hover:bg-dc-hover'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilterType('dms')}
              className={`px-2 py-0.5 rounded cursor-pointer transition-colors flex items-center gap-1 ${
                filterType === 'dms'
                  ? 'bg-dc-accent text-white font-medium'
                  : 'text-dc-text-muted hover:text-white hover:bg-dc-hover'
              }`}
            >
              <MessageCircle size={12} />
              <span>DMs</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterType('channels')}
              className={`px-2 py-0.5 rounded cursor-pointer transition-colors flex items-center gap-1 ${
                filterType === 'channels'
                  ? 'bg-dc-accent text-white font-medium'
                  : 'text-dc-text-muted hover:text-white hover:bg-dc-hover'
              }`}
            >
              <Hash size={12} />
              <span>Channels</span>
            </button>
          </div>
          <span className="text-[11px] text-dc-text-muted">
            {mode === 'messages'
              ? messageResults
                ? `${messageResults.total_matches.toLocaleString()} ${
                    messageResults.total_matches === 1 ? 'message' : 'messages'
                  } in ${messageResults.conversations.toLocaleString()} ${
                    messageResults.conversations === 1 ? 'conversation' : 'conversations'
                  }`
                : ''
              : `${filteredResults.length} ${filteredResults.length === 1 ? 'result' : 'results'}`}
          </span>
        </div>

        <div
          ref={resultsContainerRef}
          className="flex-1 overflow-y-auto p-2 flex flex-col gap-1 min-h-[160px]"
        >
          {mode === 'messages' ? (
            trimmedQuery.length < 2 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-dc-text-muted py-8 text-xs">
                <MessageSquare size={28} className="opacity-30 mb-2" />
                <span>Type at least 2 characters to search every message</span>
              </div>
            ) : messageError ? (
              <div className="flex-1 flex items-center justify-center text-dc-text-muted py-8 text-xs">
                {messageError}
              </div>
            ) : !messageResults ? (
              <div className="flex-1 flex items-center justify-center text-dc-text-muted py-8 text-xs">
                Searching every conversation…
              </div>
            ) : messageMatches.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-dc-text-muted py-8 text-xs">
                <Search size={28} className="opacity-30 mb-2" />
                <span>No messages contain &quot;{trimmedQuery}&quot;</span>
              </div>
            ) : (
              <>
                {messageMatches.map((match, index) => {
                  const isSelected = index === selectedIndex;
                  const isDm = match.channel_type === 'DM' || match.channel_type === 'GROUP_DM';
                  const snippet = snippetAround(match.contents, trimmedQuery);
                  return (
                    <button
                      key={`${match.channel_id}-${match.message_id}-${index}`}
                      type="button"
                      onClick={() => handleSelectMessage(match)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`w-full flex flex-col gap-1 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer border ${
                        isSelected
                          ? 'bg-dc-accent text-white border-dc-accent'
                          : 'bg-dc-dark/40 border-transparent hover:bg-dc-hover text-dc-text'
                      } ${isSearchingMessages ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="flex items-center gap-1.5 min-w-0 font-semibold">
                          {isDm ? <MessageCircle size={12} className="shrink-0" /> : <Hash size={12} className="shrink-0" />}
                          <span className="truncate">{match.channel_name}</span>
                          {match.server_name && (
                            <span className={`truncate font-normal ${isSelected ? 'text-white/80' : 'text-dc-text-muted'}`}>
                              in {match.server_name}
                            </span>
                          )}
                        </span>
                        <span className={`shrink-0 ${isSelected ? 'text-white/80' : 'text-dc-text-muted'}`}>
                          {formatResultDate(match.timestamp)}
                        </span>
                      </div>
                      <span className="text-xs leading-snug line-clamp-2 break-words">
                        {snippet.before}
                        {snippet.match && (
                          <mark
                            className={`rounded px-0.5 ${
                              isSelected ? 'bg-white/30 text-white' : 'bg-dc-accent/40 text-white'
                            }`}
                          >
                            {snippet.match}
                          </mark>
                        )}
                        {snippet.after}
                      </span>
                    </button>
                  );
                })}
                {messageResults.total_matches > messageMatches.length && (
                  <div className="text-[11px] text-dc-text-muted text-center py-2">
                    Showing the newest {messageMatches.length.toLocaleString()}. Add more words to narrow it down.
                  </div>
                )}
              </>
            )
          ) : filteredResults.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-dc-text-muted py-8 text-xs">
              <Search size={28} className="opacity-30" />
              <span>No conversations found matching &quot;{query}&quot;</span>
              {trimmedQuery.length >= 2 && (
                <button
                  type="button"
                  onClick={() => setMode('messages')}
                  className="px-3 py-1.5 rounded bg-dc-accent hover:bg-dc-accent/90 text-white font-medium cursor-pointer"
                >
                  Search messages for &quot;{trimmedQuery}&quot;
                </button>
              )}
            </div>
          ) : (
            filteredResults.map((item, index) => {
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors cursor-pointer border ${
                    isSelected
                      ? 'bg-dc-accent text-white border-dc-accent'
                      : 'bg-dc-dark/40 border-transparent hover:bg-dc-hover text-dc-text'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-dc-dark text-dc-text-muted'
                      }`}
                    >
                      {item.type === 'dm' ? <MessageCircle size={15} /> : <Hash size={15} />}
                    </div>

                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm truncate">{item.name}</span>
                        {item.type === 'dm' && item.recipientId && (
                          <span
                            className={`text-[10px] px-1.5 py-0.2 rounded font-mono truncate max-w-[120px] ${
                              isSelected ? 'bg-white/20 text-white' : 'bg-dc-dark text-dc-text-muted'
                            }`}
                          >
                            {item.recipientId}
                          </span>
                        )}
                      </div>

                      {item.type === 'channel' && item.serverName && (
                        <span
                          className={`text-[11px] truncate ${
                            isSelected ? 'text-white/80' : 'text-dc-text-muted'
                          }`}
                        >
                          in {item.serverName}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {item.messageCount > 0 && (
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                          isSelected ? 'bg-white/20 text-white' : 'bg-dc-dark text-dc-text-muted'
                        }`}
                      >
                        {item.messageCount.toLocaleString()} msgs
                      </span>
                    )}
                    {isSelected && <ArrowRight size={14} className="opacity-80" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="px-3 py-2 bg-dc-dark border-t border-dc-dark flex items-center justify-between text-[11px] text-dc-text-muted">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-dc-darker rounded border border-dc-input text-[10px]">↑</kbd>
              <kbd className="px-1.5 py-0.5 bg-dc-darker rounded border border-dc-input text-[10px]">↓</kbd>
              <span>to navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-dc-darker rounded border border-dc-input text-[10px] flex items-center gap-0.5">
                <CornerDownLeft size={10} />
                <span>Enter</span>
              </kbd>
              <span>to select</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-dc-darker rounded border border-dc-input text-[10px]">Tab</kbd>
              <span>{mode === 'messages' ? 'conversations' : 'messages'}</span>
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-dc-darker rounded border border-dc-input text-[10px]">Esc</kbd>
            <span>to close</span>
          </span>
        </div>
      </div>
    </div>
  );
}
