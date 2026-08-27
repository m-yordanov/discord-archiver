import { useState } from 'react';
import { MessageCircle, Plus } from 'lucide-react';
import { DataIndex, ChannelInfo } from '../types';
import { ContextMenu, ContextMenuItem } from './ContextMenu';

type DmSortMode = 'most_messages' | 'last_message' | 'first_message' | 'alphabetical';

interface SidebarProps {
  dataIndex: DataIndex;
  selectedServer: string | null;
  selectedChannel: ChannelInfo | null;
  onSelectServer: (serverId: string) => void;
  onSelectChannel: (channel: ChannelInfo) => void;
  onOpenFolder: () => void;
  onOpenZip: () => void;
}

export function Sidebar({
  dataIndex,
  selectedServer,
  selectedChannel,
  onSelectServer,
  onSelectChannel,
  onOpenFolder,
  onOpenZip,
}: SidebarProps) {
  const [dmSortMode, setDmSortMode] = useState<DmSortMode>('most_messages');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  const isDMs = selectedServer === 'dms';
  const rawChannels = isDMs
    ? dataIndex.direct_messages
    : dataIndex.servers.find(s => s.id === selectedServer)?.channels || [];
    
  const title = isDMs
    ? 'Direct Messages'
    : dataIndex.servers.find(s => s.id === selectedServer)?.name || 'Unknown Server';

  const currentChannels = [...rawChannels].sort((a, b) => {
    if (isDMs) {
      if (dmSortMode === 'most_messages') {
        return b.message_count - a.message_count;
      }
      if (dmSortMode === 'last_message') {
        const timeA = a.last_message_timestamp ? new Date(a.last_message_timestamp.replace(' ', 'T')).getTime() : 0;
        const timeB = b.last_message_timestamp ? new Date(b.last_message_timestamp.replace(' ', 'T')).getTime() : 0;
        return timeB - timeA;
      }
      if (dmSortMode === 'first_message') {
        const timeA = a.first_message_timestamp ? new Date(a.first_message_timestamp.replace(' ', 'T')).getTime() : Number.MAX_SAFE_INTEGER;
        const timeB = b.first_message_timestamp ? new Date(b.first_message_timestamp.replace(' ', 'T')).getTime() : Number.MAX_SAFE_INTEGER;
        return timeA - timeB;
      }
      if (dmSortMode === 'alphabetical') {
        return a.name.localeCompare(b.name);
      }
    }
    return 0;
  });

  const handleOpenPackageMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({
      x: rect.right + 8,
      y: rect.top,
      items: [
        { label: 'Open Folder', onClick: onOpenFolder },
        { label: 'Open .zip', onClick: onOpenZip },
      ],
    });
  };

  const getInitials = (name: string) => {
    return name.substring(0, 2).toUpperCase();
  };

  const handleChannelContextMenu = (e: React.MouseEvent, channel: ChannelInfo) => {
    e.preventDefault();
    const items: ContextMenuItem[] = [];

    if (isDMs && channel.recipient_id) {
      items.push({
        label: 'Copy User ID',
        value: channel.recipient_id,
        badge: 'ID',
      });
    }

    if (isDMs && channel.name) {
      items.push({
        label: 'Copy Username',
        value: channel.name,
      });
    }

    items.push({
      label: 'Copy Channel ID',
      value: channel.id,
    });

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items,
    });
  };

  return (
    <div className="flex h-full select-none">
      <div className="w-[72px] bg-dc-dark flex flex-col items-center py-3 gap-2 overflow-y-auto">
        <button
          title="Direct Messages"
          onClick={() => onSelectServer('dms')}
          className={`w-12 h-12 flex shrink-0 items-center justify-center text-white rounded-full transition-all duration-200 cursor-pointer ${
            isDMs ? 'bg-dc-accent' : 'bg-dc-darkest hover:bg-dc-accent'
          } relative group`}
        >
          <MessageCircle />
          {isDMs && <div className="absolute -left-3 top-2 bottom-2 w-1 bg-white rounded-r-lg" />}
        </button>

        <div className="w-8 h-[2px] bg-dc-divider my-2 rounded-full shrink-0" />

        {dataIndex.servers.map((server) => {
          const isActive = selectedServer === server.id;
          return (
            <button
              key={server.id}
              title={server.name}
              onClick={() => onSelectServer(server.id)}
              className={`w-12 h-12 flex shrink-0 items-center justify-center text-white transition-all duration-200 cursor-pointer ${
                isActive ? 'bg-dc-accent rounded-2xl' : 'bg-dc-darkest rounded-full hover:rounded-2xl hover:bg-dc-accent'
              } relative group`}
            >
              <span className="font-medium text-sm">{getInitials(server.name)}</span>
              {isActive && <div className="absolute -left-3 top-2 bottom-2 w-1 bg-white rounded-r-lg" />}
            </button>
          );
        })}
        
        <div className="w-8 h-[2px] bg-dc-divider my-2 rounded-full shrink-0" />
        
        <button
          title="Open another data package"
          onClick={handleOpenPackageMenu}
          className="w-12 h-12 shrink-0 flex items-center justify-center text-dc-green bg-dc-darkest rounded-full hover:rounded-2xl hover:bg-dc-green hover:text-white transition-all duration-200 cursor-pointer"
        >
          <Plus />
        </button>
      </div>

      <div className="w-[240px] bg-dc-darker flex flex-col">
        <div className="h-12 flex items-center justify-between px-3 font-bold text-white shadow-sm shrink-0 border-b border-dc-dark gap-2">
          <span className="truncate text-sm">{title}</span>
          {isDMs && (
            <select
              value={dmSortMode}
              onChange={(e) => setDmSortMode(e.target.value as DmSortMode)}
              className="text-[10px] bg-dc-dark text-dc-text-muted hover:text-white px-1.5 py-0.5 rounded border border-dc-input/60 cursor-pointer outline-none transition-colors shrink-0 font-normal"
              title="Sort Direct Messages"
            >
              <option value="most_messages">Most Messages</option>
              <option value="last_message">Last Message Sent</option>
              <option value="first_message">First Message Sent</option>
              <option value="alphabetical">Alphabetical</option>
            </select>
          )}
        </div>
        
        <div className="flex-1 overflow-y-auto py-2 px-2">
          {currentChannels.map(channel => {
            const isActive = selectedChannel?.id === channel.id;
            return (
              <button
                key={channel.id}
                onClick={() => onSelectChannel(channel)}
                onContextMenu={(e) => handleChannelContextMenu(e, channel)}
                className={`w-full flex items-center px-2 py-1.5 mb-0.5 rounded transition-colors cursor-pointer text-left ${
                  isActive ? 'bg-dc-input text-white' : 'text-dc-text-muted hover:bg-dc-hover hover:text-dc-text'
                }`}
              >
                <span className="text-xl opacity-60 mr-2 shrink-0 leading-none">
                  {isDMs ? '@' : '#'}
                </span>
                <span className="truncate flex-1 text-sm">{channel.name || 'Unknown'}</span>
                {channel.message_count > 0 && (
                  <span className="text-[10px] text-dc-text-muted/80 bg-dc-dark/70 px-1.5 py-0.5 rounded-full shrink-0 ml-1.5 font-medium">
                    {channel.message_count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
