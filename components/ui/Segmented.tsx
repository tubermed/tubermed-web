// Shared equal-width segmented toggle — lifted from the scribe Микрофон/Телефон
// `TabBtn` so that ad-hoc toggle is gone and both pills come from ONE place.
// Byte-identical to the old TabBtn: equal-width pills, active = filled
// `--color-brand` (white text), inactive = `--color-bg-card` + hairline border.
// Chrome only — no a11y semantics added here (kept identical to the original);
// `className` is for layout (e.g. the ModeTabs `mb-6`).

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
    <div className={['flex gap-2', className].filter(Boolean).join(' ')}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="flex-1 px-4 py-2 rounded-md text-sm font-medium transition"
            style={{
              background: active ? 'var(--color-brand)' : 'var(--color-bg-card)',
              color: active ? 'white' : 'var(--color-text-muted)',
              borderColor: 'var(--color-border)',
              borderWidth: 1,
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
