import { useEffect, useState, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  value?: string;
  badge?: string;
  onClick?: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleClickOutside);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const handleClick = async (item: ContextMenuItem, index: number) => {
    if (item.onClick) {
      item.onClick();
      onClose();
      return;
    }

    if (item.value !== undefined) {
      try {
        await navigator.clipboard.writeText(item.value);
        setCopiedIndex(index);
        setTimeout(() => {
          onClose();
        }, 400);
      } catch (e) {
        console.error(e);
        onClose();
      }
    }
  };

  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 150);

  return (
    <div
      ref={menuRef}
      style={{ top: `${adjustedY}px`, left: `${adjustedX}px` }}
      className="fixed z-50 min-w-[190px] bg-[#111214] border border-[#202225] rounded-md p-1.5 shadow-2xl flex flex-col gap-0.5 select-none text-xs text-dc-text"
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          onClick={() => handleClick(item, index)}
          className="flex items-center justify-between w-full px-2.5 py-1.5 rounded hover:bg-dc-accent hover:text-white transition-colors cursor-pointer text-left font-medium"
        >
          <span>{item.label}</span>
          {copiedIndex === index ? (
            <span className="text-[10px] text-emerald-400 font-bold">Copied!</span>
          ) : (
            item.badge && <span className="text-[10px] opacity-60">{item.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}
