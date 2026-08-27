import { useEffect } from 'react';

interface ImageModalProps {
  imageUrl: string | null;
  onClose: () => void;
}

export function ImageModal({ imageUrl, onClose }: ImageModalProps) {
  useEffect(() => {
    if (!imageUrl) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imageUrl, onClose]);

  if (!imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4 cursor-zoom-out select-none"
      onClick={onClose}
    >
      <div
        className="relative max-w-[90vw] max-h-[85vh] flex flex-col items-center cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={imageUrl}
          alt="Enlarged attachment"
          className="max-w-[90vw] max-h-[80vh] object-contain rounded-md shadow-2xl"
        />
        <div className="mt-3 flex items-center gap-4 text-sm">
          <a
            href={imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-dc-text-link hover:underline font-medium cursor-pointer"
          >
            Open in Browser
          </a>
          <span className="text-dc-text-muted">•</span>
          <button
            type="button"
            onClick={onClose}
            className="text-dc-text-muted hover:text-white transition-colors cursor-pointer"
          >
            Close (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
