// Shared equal-width segmented toggle (the scribe Микрофон/Телефон switch).
// Calm-clinical "track" style: a soft hairline-bordered track holds two
// equal-width pills; the ACTIVE pill is a white sheet (navy heading text +
// whisper shadow), INACTIVE pills are transparent with muted text — matching
// the approved calm_scribe house style. Chrome only by default — pass
// `ariaLabel` to get radiogroup/radio semantics (a screen reader then hears
// the group name and which option is checked); `className` is for
// layout/width (e.g. ModeTabs `max-w-md mx-auto`).

import type { ReactNode } from 'react';

export type SegmentedOption<T extends string> = { value: T; content: ReactNode };

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = '',
  ariaLabel,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role={ariaLabel ? 'radiogroup' : undefined}
      aria-label={ariaLabel}
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
            role={ariaLabel ? 'radio' : undefined}
            aria-checked={ariaLabel ? active : undefined}
            onClick={() => onChange(opt.value)}
            className="flex-1 px-4 py-2 rounded-md text-sm font-medium transition focus-ring"
            style={{
              background: active ? 'var(--color-bg-surface)' : 'transparent',
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
