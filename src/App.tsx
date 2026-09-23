import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { DataIndex, ChannelInfo } from './types';
import { WelcomeScreen } from './components/WelcomeScreen';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { ConversationSearchModal } from './components/ConversationSearchModal';
import { SettingsModal } from './components/SettingsModal';
import { loadSettings } from './settings';

export default function App() {
  const [dataIndex, setDataIndex] = useState<DataIndex | null>(null);
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<ChannelInfo | null>(null);
  const [dataPath, setDataPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const loadData = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const index: DataIndex = await invoke('load_data_package', { path });
      setDataPath(path);
      setDataIndex(index);
      setSelectedServer('dms');
      setSelectedChannel(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Could not read that data package.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === 'enter') {
        setIsDragging(true);
      } else if (payload.type === 'leave') {
        setIsDragging(false);
      } else if (payload.type === 'drop') {
        setIsDragging(false);
        const [path] = payload.paths;
        if (path) loadData(path);
      }
    });

    return () => {
      unlisten.then((stop) => stop());
    };
  }, [loadData]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (dataIndex) {
          setIsSearchOpen(prev => !prev);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setIsSettingsOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dataIndex]);

  useEffect(() => {
    loadSettings();
  }, []);

  const handleClosePackage = useCallback(() => {
    setDataIndex(null);
    setSelectedServer(null);
    setSelectedChannel(null);
    setDataPath(null);
    setIsSettingsOpen(false);
  }, []);

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') await loadData(selected);
  };

  const handleOpenZip = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Discord data package', extensions: ['zip'] }],
    });
    if (typeof selected === 'string') await loadData(selected);
  };

  const canonicalId = (id: string) => id.replace(/^c/, '');

  const handleOpenDmByUserId = (userId: string): boolean => {
    if (!dataIndex) return false;
    const target = canonicalId(userId);
    const found = dataIndex.direct_messages.find(
      dm =>
        dm.recipient_id === userId ||
        canonicalId(dm.recipient_id || '') === target ||
        (dm.recipients?.some(r => r === userId || canonicalId(r) === target) ?? false) ||
        dm.id === userId ||
        canonicalId(dm.id) === target ||
        dm.folder_names.some(f => f === userId || canonicalId(f) === target)
    );
    if (found) {
      setSelectedServer('dms');
      setSelectedChannel(found);
      return true;
    }
    return false;
  };

  const handleOpenChannelById = (channelId: string): boolean => {
    if (!dataIndex) return false;
    const target = canonicalId(channelId);

    const dm = dataIndex.direct_messages.find(
      entry =>
        entry.id === channelId ||
        canonicalId(entry.id) === target ||
        entry.folder_names.some(f => f === channelId || canonicalId(f) === target) ||
        entry.recipient_id === channelId ||
        canonicalId(entry.recipient_id || '') === target ||
        (entry.recipients?.some(r => r === channelId || canonicalId(r) === target) ?? false)
    );
    if (dm) {
      setSelectedServer('dms');
      setSelectedChannel(dm);
      return true;
    }

    for (const server of dataIndex.servers) {
      const found = server.channels.find(
        entry =>
          entry.id === channelId ||
          canonicalId(entry.id) === target ||
          entry.folder_names.some(f => f === channelId || canonicalId(f) === target)
      );
      if (found) {
        setSelectedServer(server.id);
        setSelectedChannel(found);
        return true;
      }
    }

    return false;
  };

  const dropOverlay = isDragging && (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-dc-darkest/80 backdrop-blur-sm pointer-events-none">
      <div className="border-2 border-dashed border-dc-accent rounded-xl px-10 py-8 text-center bg-dc-darker/90">
        <div className="text-4xl mb-2">📦</div>
        <div className="text-white font-semibold">Drop to open</div>
        <div className="text-dc-text-muted text-sm mt-1">A package folder or a .zip archive</div>
      </div>
    </div>
  );

  return (
    <>
      {!dataIndex ? (
        <WelcomeScreen
          onOpenFolder={handleOpenFolder}
          onOpenZip={handleOpenZip}
          loading={loading}
          error={error}
        />
      ) : (
        <div className="flex h-screen w-screen overflow-hidden">
          <Sidebar
            dataIndex={dataIndex}
            selectedServer={selectedServer}
            selectedChannel={selectedChannel}
            onSelectServer={setSelectedServer}
            onSelectChannel={setSelectedChannel}
            onOpenFolder={handleOpenFolder}
            onOpenZip={handleOpenZip}
            onOpenSearch={() => setIsSearchOpen(true)}
          />
          <ChatView
            selectedChannel={selectedChannel}
            dataPath={dataPath}
            userMap={dataIndex.user_map}
            onOpenDmByUserId={handleOpenDmByUserId}
            onOpenChannelById={handleOpenChannelById}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        </div>
      )}

      {dataIndex && (
        <ConversationSearchModal
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          dataIndex={dataIndex}
          onSelectDm={(channel) => {
            setSelectedServer('dms');
            setSelectedChannel(channel);
          }}
          onSelectServerChannel={(serverId, channel) => {
            setSelectedServer(serverId);
            setSelectedChannel(channel);
          }}
        />
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        dataIndex={dataIndex}
        dataPath={dataPath}
        onClosePackage={handleClosePackage}
      />

      {loading && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-dc-darkest/80 text-dc-text">
          Opening package…
        </div>
      )}
      {error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[95] flex items-center gap-3 bg-dc-dark border border-dc-input rounded-md px-4 py-2.5 shadow-2xl text-sm">
          <span className="text-amber-400">⚠️</span>
          <span className="text-white">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-dc-text-muted hover:text-white cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}
      {dropOverlay}
    </>
  );
}
