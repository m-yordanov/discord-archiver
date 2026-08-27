interface WelcomeScreenProps {
  onOpenFolder: () => void;
  onOpenZip: () => void;
  loading?: boolean;
  error?: string | null;
}

export function WelcomeScreen({ onOpenFolder, onOpenZip, loading, error }: WelcomeScreenProps) {
  return (
    <div className="flex items-center justify-center h-full w-full bg-dc-darkest">
      <div className="bg-dc-darker p-8 rounded-lg shadow-lg flex flex-col items-center gap-6 max-w-md text-center">
        <h1 className="text-3xl font-bold text-white">Discord Archiver</h1>
        <p className="text-dc-text-muted text-lg">
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
      </div>
    </div>
  );
}
