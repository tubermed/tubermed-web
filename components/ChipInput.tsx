'use client';

import { useState, type KeyboardEvent } from 'react';

interface ChipInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Optional element rendered to the right of the input row (e.g. "+ Избери от МКБ"). */
  trailing?: React.ReactNode;
  /** Cap on visible items; storage is uncapped. */
  maxRows?: number;
}

export default function ChipInput({ value, onChange, placeholder = 'Добави и натисни Enter', trailing }: ChipInputProps) {
  const [draft, setDraft] = useState('');

  function commit(next: string) {
    const t = next.trim();
    if (!t) return;
    if (value.includes(t)) { setDraft(''); return; }
    onChange([...value, t]);
    setDraft('');
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      className="rounded-md px-2 py-2 flex flex-wrap items-center gap-2 min-h-[44px]"
      style={{ background: 'white', border: '1px solid var(--color-border-mid)' }}
    >
      {value.map((chip, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs"
          style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}
        >
          {chip}
          <button
            type="button"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            aria-label={`Премахни ${chip}`}
            className="text-sm leading-none opacity-70 hover:opacity-100"
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => commit(draft)}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[140px] bg-transparent outline-none text-sm py-1"
        style={{ color: 'var(--color-text)' }}
      />
      {trailing}
    </div>
  );
}
