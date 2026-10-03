import { X, Clock } from 'lucide-react';
import { RecentPackage } from '../recentPackages';

interface WelcomeScreenProps {
  onOpenFolder: () => void;
  onOpenZip: () => void;
  recentPackages?: RecentPackage[];
  onOpenRecent?: (path: string) => void;
  onRemoveRecent?: (path: string) => void;
  onClearRecent?: () => void;
  loading?: boolean;
  error?: string | null;
}

export function WelcomeScreen({
  onOpenFolder,
  onOpenZip,
  recentPackages,
  onOpenRecent,
  onRemoveRecent,
  onClearRecent,
  loading,
  error,
}: WelcomeScreenProps) {
  return (
    <div className="flex items-center justify-center h-full w-full bg-dc-darkest">
      <div className="bg-dc-darker p-8 rounded-lg shadow-lg flex flex-col items-center gap-6 max-w-lg w-full text-center mx-4">
        <h1 className="text-3xl font-bold text-white">Discord Archiver</h1>
        <p className="text-dc-text-muted text-base">
          Load a Discord data package to view your archived messages, channels, and servers.
        </p>

        {loading ? (
          <div className="text-dc-text py-3">Opening package…</div>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={onOpenFolder}
              className="bg-dc-accent hover:bg-opacity-90 text-white font-medium py-3 px-6 rounded transition-colors cursor-pointer"
            >
              Open Folder
            </button>
            <button
              onClick={onOpenZip}
              className="bg-dc-input hover:bg-dc-hover text-dc-text hover:text-white font-medium py-3 px-6 rounded transition-colors cursor-pointer"
            >
              Open .zip
            </button>
          </div>
        )}

        <p className="text-dc-text-muted text-xs">
          …or drag the folder or <span className="text-dc-text">.zip</span> straight onto this window.
        </p>

        {error && (
          <div className="w-full flex items-start gap-2 text-left bg-dc-darkest border border-red-500/40 rounded px-3 py-2.5 text-xs text-dc-text">
            <span className="text-amber-400 shrink-0">⚠️</span>
            <span className="break-words">{error}</span>
          </div>
        )}

        {recentPackages && recentPackages.length > 0 && !loading && (
          <div className="w-full mt-1 pt-5 border-t border-dc-input/30 flex flex-col gap-2.5 text-left">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-dc-text-muted uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Previous Packages
              </span>
              {onClearRecent && recentPackages.length > 1 && (
                <button
                  type="button"
                  onClick={onClearRecent}
                  className="text-[11px] text-dc-text-muted hover:text-red-400 transition-colors cursor-pointer"
                >
                  Clear all
                </button>
              )}
            </div>

            <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
              {recentPackages.map((pkg) => (
                <div
                  key={pkg.path}
                  onClick={() => onOpenRecent?.(pkg.path)}
                  className="group flex items-center justify-between p-2.5 rounded-lg bg-dc-darkest/70 hover:bg-dc-hover border border-dc-input/30 hover:border-dc-accent/60 transition-all cursor-pointer"
                  title={pkg.path}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
                    <span className="text-lg shrink-0">
                      {pkg.type === 'zip' ? '📦' : '📁'}
                    </span>
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white group-hover:text-dc-accent transition-colors truncate">
                          {pkg.name}
                        </span>
                        <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-dc-dark text-dc-text-muted border border-dc-input/40 shrink-0 font-medium">
                          {pkg.type === 'zip' ? '.ZIP' : 'FOLDER'}
                        </span>
                      </div>
                      <span className="text-[10px] text-dc-text-muted truncate font-mono">
                        {pkg.path}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {pkg.totalMessages !== undefined && pkg.totalMessages > 0 && (
                      <span className="text-[10px] text-dc-text-muted hidden sm:inline">
                        {pkg.totalMessages.toLocaleString()} msgs
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveRecent?.(pkg.path);
                      }}
                      className="p-1 rounded text-dc-text-muted hover:text-white hover:bg-dc-dark/80 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                      title="Remove from history"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
