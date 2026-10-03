import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { DataIndex, ChannelInfo } from './types';
import { WelcomeScreen } from './components/WelcomeScreen';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { ConversationSearchModal } from './components/ConversationSearchModal';
import { StatsView } from './components/StatsView';
import { ChannelStats, PackageStats } from './stats';
import {
  RecentPackage,
  getRecentPackages,
  addRecentPackage,
  removeRecentPackage,
  clearRecentPackages,
} from './recentPackages';
import { SettingsModal } from './components/SettingsModal';
import { loadSettings } from './settings';

type View = 'messages' | 'stats';

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
  const [recentPackages, setRecentPackages] = useState<RecentPackage[]>(getRecentPackages);
  const [view, setView] = useState<View>('messages');
  const [stats, setStats] = useState<PackageStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const loadingPackageRef = useRef(false);
  const dataPathRef = useRef(dataPath);
  dataPathRef.current = dataPath;

  const loadData = useCallback(async (path: string) => {
    if (loadingPackageRef.current) return;
    loadingPackageRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const index: DataIndex = await invoke('load_data_package', { path });
      const totalMessages =
        index.servers.reduce((acc, s) => acc + s.channels.reduce((ca, c) => ca + c.message_count, 0), 0) +
        index.direct_messages.reduce((acc, dm) => acc + dm.message_count, 0);

      setDataPath(path);
      setDataIndex(index);
      setSelectedServer('dms');
      setSelectedChannel(null);
      setView('messages');
      setStats(null);
      setStatsError(null);
      setRecentPackages(addRecentPackage(path, totalMessages));
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Could not read that data package.');
    } finally {
      loadingPackageRef.current = false;
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

  useEffect(() => {
    if (view !== 'stats' || stats || statsLoading || !dataPath) return;

    const loadStats = async () => {
      setStatsLoading(true);
      setStatsError(null);
      try {
        const result: PackageStats = await invoke('get_stats', { path: dataPath });
        if (dataPathRef.current === dataPath) setStats(result);
      } catch (e) {
        if (dataPathRef.current === dataPath) {
          setStatsError(typeof e === 'string' ? e : 'Could not read statistics.');
        }
      } finally {
        setStatsLoading(false);
      }
    };

    loadStats();
  }, [view, stats, statsLoading, dataPath]);

  const handleClosePackage = useCallback(() => {
    setDataIndex(null);
    setSelectedServer(null);
    setSelectedChannel(null);
    setDataPath(null);
    setIsSettingsOpen(false);
    setView('messages');
    setStats(null);
    setStatsError(null);
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

  const handleRemoveRecent = useCallback((pathToRemove: string) => {
    setRecentPackages(removeRecentPackage(pathToRemove));
  }, []);

  const handleClearRecent = useCallback(() => {
    clearRecentPackages();
    setRecentPackages([]);
  }, []);

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
          recentPackages={recentPackages}
          onOpenRecent={loadData}
          onRemoveRecent={handleRemoveRecent}
          onClearRecent={handleClearRecent}
          loading={loading}
          error={error}
        />
      ) : (
        <div className="flex h-screen w-screen overflow-hidden">
          <Sidebar
            dataIndex={dataIndex}
            selectedServer={selectedServer}
            selectedChannel={selectedChannel}
            onSelectServer={handleSelectServer}
            onSelectChannel={setSelectedChannel}
            onOpenFolder={handleOpenFolder}
            onOpenZip={handleOpenZip}
            onOpenSearch={() => setIsSearchOpen(true)}
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
              onOpenChannelById={handleOpenChannelById}
              onOpenSettings={() => setIsSettingsOpen(true)}
            />
          )}
        </div>
      )}

      {dataIndex && (
        <ConversationSearchModal
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          dataIndex={dataIndex}
          onSelectDm={(channel) => {
            setView('messages');
            setSelectedServer('dms');
            setSelectedChannel(channel);
          }}
          onSelectServerChannel={(serverId, channel) => {
            setView('messages');
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
