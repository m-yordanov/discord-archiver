import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { DataIndex, ChannelInfo } from './types';
import { WelcomeScreen } from './components/WelcomeScreen';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { StatsView } from './components/StatsView';
import { ChannelStats, PackageStats } from './stats';

type View = 'messages' | 'stats';

export default function App() {
  const [dataIndex, setDataIndex] = useState<DataIndex | null>(null);
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<ChannelInfo | null>(null);
  const [dataPath, setDataPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [view, setView] = useState<View>('messages');
  const [stats, setStats] = useState<PackageStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const loadData = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const index: DataIndex = await invoke('load_data_package', { path });
      setDataPath(path);
      setDataIndex(index);
      setSelectedServer('dms');
      setSelectedChannel(null);
      setView('messages');
      setStats(null);
      setStatsError(null);
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
    if (view !== 'stats' || stats || statsLoading || !dataPath) return;

    const loadStats = async () => {
      setStatsLoading(true);
      setStatsError(null);
      try {
        const result: PackageStats = await invoke('get_stats', { path: dataPath });
        setStats(result);
      } catch (e) {
        setStatsError(typeof e === 'string' ? e : 'Could not read statistics.');
      } finally {
        setStatsLoading(false);
      }
    };

    loadStats();
  }, [view, stats, statsLoading, dataPath]);

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
      dm => dm.recipient_id === userId || (dm.recipients?.includes(userId) ?? false)
    );
    if (found) {
      setSelectedServer('dms');
      setSelectedChannel(found);
      return true;
    }
    return false;
  };

  const handleOpenChannelFromStats = (channel: ChannelStats) => {
    if (!dataIndex) return;

    const dm = dataIndex.direct_messages.find(entry => entry.id === channel.id);
    if (dm) {
      setView('messages');
      setSelectedServer('dms');
      setSelectedChannel(dm);
      return;
    }

    for (const server of dataIndex.servers) {
      const found = server.channels.find(entry => entry.id === channel.id);
      if (found) {
        setView('messages');
        setSelectedServer(server.id);
        setSelectedChannel(found);
        return;
      }
    }
  };

  const handleSelectServer = (serverId: string) => {
    setView('messages');
    setSelectedServer(serverId);
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
          onSelectServer={handleSelectServer}
          onSelectChannel={setSelectedChannel}
          onOpenFolder={handleOpenFolder}
          onOpenZip={handleOpenZip}
          view={view}
          onSelectView={setView}
        />
        {view === 'stats' ? (
          <StatsView
            stats={stats}
            loading={statsLoading}
            error={statsError}
            onOpenChannel={handleOpenChannelFromStats}
          />
        ) : (
          <ChatView
            selectedChannel={selectedChannel}
            dataPath={dataPath}
            userMap={dataIndex.user_map}
            onOpenDmByUserId={handleOpenDmByUserId}
          />
        )}
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
