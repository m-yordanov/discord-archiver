import { useState, useEffect } from 'react';
import { Database, Palette, Globe, Info, X, LogOut, Check } from 'lucide-react';
import { DataIndex } from '../types';
import { AppSettings, loadSettings, saveSettings } from '../settings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  dataIndex: DataIndex | null;
  dataPath: string | null;
  onClosePackage: () => void;
}

type SettingsTab = 'archive' | 'appearance' | 'media' | 'about';

export function SettingsModal({
  isOpen,
  onClose,
  dataIndex,
  dataPath,
  onClosePackage,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('archive');
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSettings(loadSettings());
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    saveSettings(updated);
    setToast('Setting saved');
    setTimeout(() => setToast(null), 2000);
  };

  if (!isOpen) return null;

  const totalMessages = dataIndex
    ? dataIndex.servers.reduce(
        (acc, s) => acc + s.channels.reduce((ca, c) => ca + c.message_count, 0),
        0
      ) + dataIndex.direct_messages.reduce((acc, dm) => acc + dm.message_count, 0)
    : 0;

  return (
    <div className="fixed inset-0 z-[120] flex bg-black/70 backdrop-blur-sm select-none animate-in fade-in duration-150">
      <div className="flex-1 flex max-w-5xl mx-auto my-6 bg-dc-darkest rounded-xl overflow-hidden shadow-2xl border border-dc-dark">
        <div className="w-56 bg-dc-darker flex flex-col justify-between p-4 border-r border-dc-dark shrink-0">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-dc-text-muted uppercase px-2 mb-1.5 tracking-wider">
              Settings
            </span>

            <button
              type="button"
              onClick={() => setActiveTab('archive')}
              className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer text-left ${
                activeTab === 'archive'
                  ? 'bg-dc-accent text-white'
                  : 'text-dc-text-muted hover:text-white hover:bg-dc-hover'
              }`}
            >
              <Database className="w-4 h-4 shrink-0" />
              <span>Archive Info</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('appearance')}
              className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer text-left ${
                activeTab === 'appearance'
                  ? 'bg-dc-accent text-white'
                  : 'text-dc-text-muted hover:text-white hover:bg-dc-hover'
              }`}
            >
              <Palette className="w-4 h-4 shrink-0" />
              <span>Appearance</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('media')}
              className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer text-left ${
                activeTab === 'media'
                  ? 'bg-dc-accent text-white'
                  : 'text-dc-text-muted hover:text-white hover:bg-dc-hover'
              }`}
            >
              <Globe className="w-4 h-4 shrink-0" />
              <span>Media & Links</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('about')}
              className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer text-left ${
                activeTab === 'about'
                  ? 'bg-dc-accent text-white'
                  : 'text-dc-text-muted hover:text-white hover:bg-dc-hover'
              }`}
            >
              <Info className="w-4 h-4 shrink-0" />
              <span>About</span>
            </button>
          </div>

          <div className="pt-3 border-t border-dc-input/30 flex flex-col gap-2">
            {dataIndex && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onClosePackage();
                }}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer text-left"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span>Close Package</span>
              </button>
            )}

            <div className="text-[10px] text-dc-text-muted px-2">
              Discord Archiver v0.1.0
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0 bg-dc-darkest relative">
          <div className="h-14 flex items-center justify-between px-8 border-b border-dc-dark shrink-0">
            <h2 className="text-base font-bold text-white">
              {activeTab === 'archive' && 'Archive Information'}
              {activeTab === 'appearance' && 'Appearance Settings'}
              {activeTab === 'media' && 'Media & Link Settings'}
              {activeTab === 'about' && 'About Discord Archiver'}
            </h2>

            <button
              type="button"
              onClick={onClose}
              className="flex flex-col items-center justify-center text-dc-text-muted hover:text-white transition-colors cursor-pointer group"
              title="Close Settings (Esc)"
            >
              <div className="w-7 h-7 rounded-full border border-dc-text-muted/40 group-hover:border-white flex items-center justify-center">
                <X className="w-4 h-4" />
              </div>
              <span className="text-[9px] font-semibold mt-0.5 tracking-wider">ESC</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-8 py-6">
            {activeTab === 'archive' && (
              <div className="flex flex-col gap-6 max-w-xl">
                <div>
                  <h3 className="text-xs font-bold text-dc-text-muted uppercase tracking-wider mb-2">
                    Current Package
                  </h3>
                  <div className="bg-dc-darker p-3 rounded-lg border border-dc-input/40 flex flex-col gap-1 text-xs">
                    <span className="text-dc-text-muted text-[11px]">Location on disk:</span>
                    <span className="text-white font-mono break-all select-text">
                      {dataPath || 'None loaded'}
                    </span>
                  </div>
                </div>

                {dataIndex && (
                  <div>
                    <h3 className="text-xs font-bold text-dc-text-muted uppercase tracking-wider mb-2">
                      Account & Archive Stats
                    </h3>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-dc-darker p-3 rounded-lg border border-dc-input/40 flex flex-col">
                        <span className="text-dc-text-muted text-[11px]">Username</span>
                        <span className="text-white font-semibold text-sm truncate">
                          {dataIndex.username || 'You'}
                        </span>
                      </div>

                      <div className="bg-dc-darker p-3 rounded-lg border border-dc-input/40 flex flex-col">
                        <span className="text-dc-text-muted text-[11px]">User ID</span>
                        <span className="text-white font-mono text-xs truncate select-text">
                          {dataIndex.user_id || 'Unknown'}
                        </span>
                      </div>

                      <div className="bg-dc-darker p-3 rounded-lg border border-dc-input/40 flex flex-col">
                        <span className="text-dc-text-muted text-[11px]">Direct Messages</span>
                        <span className="text-white font-semibold text-sm">
                          {dataIndex.direct_messages.length.toLocaleString()}
                        </span>
                      </div>

                      <div className="bg-dc-darker p-3 rounded-lg border border-dc-input/40 flex flex-col">
                        <span className="text-dc-text-muted text-[11px]">Servers</span>
                        <span className="text-white font-semibold text-sm">
                          {dataIndex.servers.length.toLocaleString()}
                        </span>
                      </div>

                      <div className="col-span-2 bg-dc-darker p-3 rounded-lg border border-dc-input/40 flex flex-col">
                        <span className="text-dc-text-muted text-[11px]">Total Messages in Archive</span>
                        <span className="text-white font-semibold text-base">
                          {totalMessages.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="flex flex-col gap-6 max-w-xl">
                <div>
                  <h3 className="text-xs font-bold text-dc-text-muted uppercase tracking-wider mb-2">
                    Theme
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => updateSetting('theme', 'dark')}
                      className={`p-3 rounded-lg border flex flex-col items-start gap-1 cursor-pointer transition-colors ${
                        settings.theme === 'dark'
                          ? 'border-dc-accent bg-dc-accent/10 text-white'
                          : 'border-dc-input/40 bg-dc-darker text-dc-text-muted hover:text-white'
                      }`}
                    >
                      <div className="w-full h-8 rounded bg-[#313338] border border-[#1e1f22] mb-1 flex items-center px-2">
                        <div className="w-3 h-3 rounded-full bg-[#5865F2]" />
                      </div>
                      <span className="text-xs font-semibold">Dark (Default)</span>
                      <span className="text-[10px] text-dc-text-muted">Classic Discord dark theme</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => updateSetting('theme', 'midnight')}
                      className={`p-3 rounded-lg border flex flex-col items-start gap-1 cursor-pointer transition-colors ${
                        settings.theme === 'midnight'
                          ? 'border-dc-accent bg-dc-accent/10 text-white'
                          : 'border-dc-input/40 bg-dc-darker text-dc-text-muted hover:text-white'
                      }`}
                    >
                      <div className="w-full h-8 rounded bg-black border border-[#1e1f22] mb-1 flex items-center px-2">
                        <div className="w-3 h-3 rounded-full bg-[#5865F2]" />
                      </div>
                      <span className="text-xs font-semibold">Midnight</span>
                      <span className="text-[10px] text-dc-text-muted">Pure black OLED contrast</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => updateSetting('theme', 'light')}
                      className={`p-3 rounded-lg border flex flex-col items-start gap-1 cursor-pointer transition-colors ${
                        settings.theme === 'light'
                          ? 'border-dc-accent bg-dc-accent/10 text-white'
                          : 'border-dc-input/40 bg-dc-darker text-dc-text-muted hover:text-white'
                      }`}
                    >
                      <div className="w-full h-8 rounded bg-[#f2f3f5] border border-gray-300 mb-1 flex items-center px-2">
                        <div className="w-3 h-3 rounded-full bg-[#5865F2]" />
                      </div>
                      <span className="text-xs font-semibold">Light</span>
                      <span className="text-[10px] text-dc-text-muted">Bright interface palette</span>
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-dc-text-muted uppercase tracking-wider mb-2">
                    Chat Font Size
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {(['small', 'normal', 'large'] as const).map(size => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => updateSetting('fontSize', size)}
                        className={`py-2 px-3 rounded-md border text-xs font-medium capitalize cursor-pointer transition-colors ${
                          settings.fontSize === size
                            ? 'bg-dc-accent text-white border-dc-accent'
                            : 'bg-dc-darker text-dc-text-muted hover:text-white border-dc-input/40'
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'media' && (
              <div className="flex flex-col gap-6 max-w-xl">
                <div>
                  <h3 className="text-xs font-bold text-dc-text-muted uppercase tracking-wider mb-2">
                    Expiring CDN Links
                  </h3>
                  <div className="bg-dc-darker p-4 rounded-lg border border-dc-input/40 flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-semibold text-white">
                        Wayback Machine Fallback
                      </span>
                      <span className="text-[11px] text-dc-text-muted leading-relaxed">
                        Automatically query the Internet Archive Wayback Machine to load attachments when Discord CDN links return 403 or 404.
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        updateSetting('enableWaybackFallback', !settings.enableWaybackFallback)
                      }
                      className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                        settings.enableWaybackFallback ? 'bg-dc-green' : 'bg-[#4e5058]'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                          settings.enableWaybackFallback ? 'left-6' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'about' && (
              <div className="flex flex-col gap-4 max-w-xl text-xs">
                <div className="bg-dc-darker p-4 rounded-lg border border-dc-input/40 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">📦</span>
                    <span className="text-sm font-bold text-white">Discord Archiver</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-dc-accent/20 text-dc-accent font-semibold border border-dc-accent/30">
                      v0.1.0
                    </span>
                  </div>
                  <p className="text-dc-text-muted leading-relaxed text-[11px]">
                    A high-performance desktop archive browser for Discord data packages and chat backups, built with Tauri, Rust, React, and Tailwind CSS.
                  </p>
                </div>

                <div className="bg-dc-darker p-4 rounded-lg border border-dc-input/40 flex flex-col gap-1.5 text-dc-text-muted text-[11px]">
                  <span className="font-semibold text-white text-xs">Keyboard Shortcuts</span>
                  <div className="flex justify-between py-1 border-b border-dc-input/20">
                    <span>Open Settings</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-dc-dark text-white font-mono text-[10px]">Ctrl+,</kbd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-dc-input/20">
                    <span>Quick Search / Jump to Conversation</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-dc-dark text-white font-mono text-[10px]">Ctrl+K</kbd>
                  </div>
                  <div className="flex justify-between py-1">
                    <span>Find in Channel</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-dc-dark text-white font-mono text-[10px]">Ctrl+F</kbd>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 bg-dc-dark text-white text-xs px-3.5 py-2 rounded-md shadow-2xl border border-dc-input flex items-center gap-2 select-none pointer-events-none">
          <Check className="w-3.5 h-3.5 text-dc-green" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
