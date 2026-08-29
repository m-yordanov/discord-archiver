import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { DataIndex, ChannelInfo } from './types';
import { WelcomeScreen } from './components/WelcomeScreen';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';

export default function App() {
  const [dataIndex, setDataIndex] = useState<DataIndex | null>(null);
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<ChannelInfo | null>(null);
  const [dataPath, setDataPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

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

  const handleOpenDmByUserId = (userId: string): boolean => {
    if (!dataIndex) return false;
    const found = dataIndex.direct_messages.find(
      dm =>
        dm.recipient_id === userId ||
        (dm.recipients?.includes(userId) ?? false) ||
        dm.id === userId ||
        dm.folder_name.replace(/^c/, '') === userId ||
        dm.folder_names?.some(f => f.replace(/^c/, '') === userId)
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

    const dm = dataIndex.direct_messages.find(
      entry =>
        entry.id === channelId ||
        entry.folder_name === channelId ||
        entry.folder_name.replace(/^c/, '') === channelId ||
        entry.folder_names?.some(f => f === channelId || f.replace(/^c/, '') === channelId) ||
        entry.recipient_id === channelId ||
        (entry.recipients?.includes(channelId) ?? false)
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
          entry.folder_name === channelId ||
          entry.folder_name.replace(/^c/, '') === channelId ||
          entry.folder_names?.some(f => f === channelId || f.replace(/^c/, '') === channelId)
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

  if (!dataIndex) {
    return (
      <>
        <WelcomeScreen
          onOpenFolder={handleOpenFolder}
          onOpenZip={handleOpenZip}
          loading={loading}
          error={error}
        />
        {dropOverlay}
      </>
    );
  }

  return (
    <>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar
          dataIndex={dataIndex}
          selectedServer={selectedServer}
          selectedChannel={selectedChannel}
          onSelectServer={setSelectedServer}
          onSelectChannel={setSelectedChannel}
          onOpenFolder={handleOpenFolder}
          onOpenZip={handleOpenZip}
        />
        <ChatView
          selectedChannel={selectedChannel}
          dataPath={dataPath}
          userMap={dataIndex.user_map}
          onOpenDmByUserId={handleOpenDmByUserId}
          onOpenChannelById={handleOpenChannelById}
        />
      </div>

      {loading && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-dc-darkest/80 text-dc-text">
          Opening package…
        </div>
      )}
      {error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[95] flex items-center gap-3 bg-[#202225] border border-dc-input rounded-md px-4 py-2.5 shadow-2xl text-sm">
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
