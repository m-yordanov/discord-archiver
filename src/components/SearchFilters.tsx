import { useEffect, useRef, useState } from 'react';
import { Filter } from 'lucide-react';
import { Segmented } from './Segmented';
import {
  AttachmentMode,
  DateMode,
  EMPTY_FILTERS,
  MessageFilters,
  countActiveFilters,
} from '../filters';

const DATE_MODES: { value: DateMode; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'before', label: 'Before' },
  { value: 'after', label: 'After' },
  { value: 'between', label: 'Between' },
];

const ATTACHMENT_MODES: { value: AttachmentMode; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'has', label: 'Has any' },
  { value: 'none', label: 'None' },
  { value: 'images', label: 'Images' },
  { value: 'videos', label: 'Videos' },
  { value: 'files', label: 'Files' },
];

interface DateFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function DateField({ label, value, onChange }: DateFieldProps) {
  return (
    <label className="flex flex-col gap-1 flex-1">
      <span className="text-[10px] uppercase tracking-wide text-dc-text-muted font-semibold">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-dc-darkest border border-dc-input/60 rounded px-2 py-1 text-xs text-white outline-none focus:border-dc-accent transition-colors [color-scheme:dark] cursor-pointer"
      />
    </label>
  );
}

interface SearchFiltersProps {
  filters: MessageFilters;
  onChange: (filters: MessageFilters) => void;
  shownCount: number;
  totalCount: number;
}

export function SearchFilters({ filters, onChange, shownCount, totalCount }: SearchFiltersProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeCount = countActiveFilters(filters);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const update = (patch: Partial<MessageFilters>) => onChange({ ...filters, ...patch });

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="Filter messages"
        className={`relative flex items-center gap-1 px-2 py-1.5 rounded text-xs transition-colors cursor-pointer border ${
          activeCount > 0 || open
            ? 'bg-dc-accent text-white border-dc-accent'
            : 'bg-dc-dark text-dc-text-muted hover:text-white border-dc-input/60'
        }`}
      >
        <Filter size={13} strokeWidth={2.2} />
        {activeCount > 0 && <span className="font-semibold">{activeCount}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-[280px] bg-[#111214] border border-[#202225] rounded-md shadow-2xl p-3 flex flex-col gap-3 select-none">
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-dc-text-muted font-semibold">
              Date
            </span>
            <Segmented
              options={DATE_MODES}
              value={filters.dateMode}
              onChange={dateMode => update({ dateMode })}
              columns="grid-cols-4"
            />
          </div>

          {filters.dateMode === 'before' && (
            <DateField label="On or before" value={filters.dateFrom} onChange={dateFrom => update({ dateFrom })} />
          )}

          {filters.dateMode === 'after' && (
            <DateField label="On or after" value={filters.dateFrom} onChange={dateFrom => update({ dateFrom })} />
          )}

          {filters.dateMode === 'between' && (
            <div className="flex gap-2">
              <DateField label="From" value={filters.dateFrom} onChange={dateFrom => update({ dateFrom })} />
              <DateField label="To" value={filters.dateTo} onChange={dateTo => update({ dateTo })} />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-dc-text-muted font-semibold">
              Attachments
            </span>
            <Segmented
              options={ATTACHMENT_MODES}
              value={filters.attachment}
              onChange={attachment => update({ attachment })}
              columns="grid-cols-3"
            />
          </div>

          <div className="flex items-center justify-between border-t border-dc-input/40 pt-2.5">
            <span className="text-[11px] text-dc-text-muted">
              {activeCount > 0 ? `${shownCount} of ${totalCount} shown` : `${totalCount} messages`}
            </span>
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTERS)}
              disabled={activeCount === 0}
              className="text-[11px] font-medium text-dc-text-muted hover:text-white disabled:opacity-30 disabled:cursor-default cursor-pointer transition-colors"
            >
              Clear all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
