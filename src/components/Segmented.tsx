interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  columns?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  columns,
}: SegmentedProps<T>) {
  return (
    <div className={columns ? `grid ${columns} gap-1` : 'inline-flex gap-1'}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors cursor-pointer border ${
            value === option.value
              ? 'bg-dc-accent text-white border-dc-accent'
              : 'bg-dc-darkest text-dc-text-muted border-dc-input/60 hover:text-white hover:bg-dc-hover'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
