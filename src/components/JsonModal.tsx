import { useEffect, useState } from 'react';

interface JsonModalProps {
  rawJson: string | null;
  onClose: () => void;
}

export function JsonModal({ rawJson, onClose }: JsonModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!rawJson) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [rawJson, onClose]);

  if (!rawJson) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 select-none"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl max-h-[85vh] bg-dc-darker rounded-lg shadow-2xl border border-dc-dark flex flex-col cursor-default overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-dc-dark bg-dc-darkest/50">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">Raw Export Data</span>
            <span className="text-xs text-dc-text-muted">(messages.json row)</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="text-xs px-2.5 py-1 rounded bg-dc-input text-dc-text hover:bg-dc-hover hover:text-white transition-colors cursor-pointer"
            >
              {copied ? 'Copied!' : 'Copy JSON'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-dc-text-muted hover:text-white text-lg leading-none px-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-4 overflow-y-auto custom-scrollbar flex-1 bg-dc-darkest font-mono text-xs text-emerald-400 select-text leading-relaxed">
          <pre className="whitespace-pre-wrap break-all">{rawJson}</pre>
        </div>
      </div>
    </div>
  );
}
