// Shared equal-width segmented toggle (the scribe Микрофон/Телефон switch).
// Calm-clinical "track" style: a soft hairline-bordered track holds two
// equal-width pills; the ACTIVE pill is a white sheet (navy heading text +
// whisper shadow), INACTIVE pills are transparent with muted text — matching
// the approved calm_scribe house style. Chrome only — no a11y semantics added
// here; `className` is for layout/width (e.g. ModeTabs `max-w-md mx-auto`).

import type { ReactNode } from 'react';

export type SegmentedOption<T extends string> = { value: T; content: ReactNode };

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={['flex gap-1 p-1 rounded-lg', className].filter(Boolean).join(' ')}
      style={{
        background: 'var(--color-bg-subtle)',
        border: '1px solid var(--color-hairline)',
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="flex-1 px-4 py-2 rounded-md text-sm font-medium transition"
            style={{
              background: active ? '#fff' : 'transparent',
              color: active ? 'var(--color-heading)' : 'var(--color-text-muted)',
              boxShadow: active ? 'var(--shadow-card)' : 'none',
            }}
          >
            {opt.content}
          </button>
        );
      })}
    </div>
  );
}

export default Segmented;
