'use client';

// Specialty typeahead for the onboarding wizard — same interaction + visual
// standard as MkbTypeahead (input + filtered dropdown, blur-timer dismiss,
// mousedown-preventDefault on the list so clicking a row doesn't blur the
// input first), plus arrow-key + Enter selection. Unlike МКБ, specialty is
// NOT a closed list: free text is always kept verbatim — the suggestions only
// replace the value when explicitly picked. No deps.

import { useEffect, useRef, useState } from 'react';

// Curated common Bulgarian specialties — suggestions only, not a closed list.
const SPECIALTIES = [
  'Общопрактикуващ лекар (ОПЛ)',
  'Кардиолог',
  'Ендокринолог',
  'Невролог',
  'Педиатър',
  'Гастроентеролог',
  'Пулмолог',
  'Уролог',
  'Нефролог',
  'Ревматолог',
  'Дерматолог',
  'Акушер-гинеколог (АГ)',
  'Офталмолог',
  'УНГ (Оториноларинголог)',
  'Ортопед',
  'Хирург',
  'Психиатър',
  'Алерголог',
  'Онколог',
  'Хематолог',
  'Инфекционист',
  'Физиотерапевт',
  'Имунолог',
  'Анестезиолог',
  'Рентгенолог',
];

const VISIBLE_MAX = 8;

export default function SpecialtyTypeahead({
  value,
  onChange,
  disabled,
  onOpenChange,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** Optional — fired whenever the suggestion dropdown opens/closes, so a host
   *  (the onboarding wizard) can gate its own Esc handling. ADD-ONLY: existing
   *  consumers (the settings page) omit it and are unaffected. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Report dropdown open-state to an optional host — no behavior change.
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const q = value.trim().toLowerCase();
  const matches = (q
    ? SPECIALTIES.filter((s) => s.toLowerCase().includes(q))
    : SPECIALTIES
  ).slice(0, VISIBLE_MAX);

  function pick(s: string) {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    onChange(s);
    setOpen(false);
    setActive(-1);
  }

  function dismiss() {
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder="напр. Кардиолог — или свободен текст"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(dismiss, 150);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // Consume Esc ONLY while the dropdown is open — dismissing the
            // suggestions must not bubble to the wizard's document-level Esc
            // handler and close the whole wizard (PATCHing completion!).
            // With the dropdown closed, Esc passes through as usual.
            if (open) {
              e.preventDefault();
              e.stopPropagation();
              dismiss();
            }
            return;
          }
          if (!open || matches.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % matches.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a <= 0 ? matches.length - 1 : a - 1));
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            pick(matches[active]);
          }
        }}
        className="w-full px-3 outline-none rounded-md"
        style={{
          height: 38,
          background: 'white',
          border: '1px solid var(--color-border-strong)',
          fontSize: 14,
          color: 'var(--color-text-primary)',
        }}
        role="combobox"
        aria-controls="specialty-typeahead-list"
        aria-expanded={open && matches.length > 0}
        aria-autocomplete="list"
      />
      {open && matches.length > 0 && (
        <div
          id="specialty-typeahead-list"
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-30 rounded-md border shadow-lg overflow-y-auto"
          style={{ background: 'white', borderColor: 'var(--color-border)', maxHeight: 240 }}
          // keep focus on the input while clicking a row (MkbTypeahead pattern)
          onMouseDown={(e) => e.preventDefault()}
        >
          {matches.map((s, i) => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={i === active}
              onClick={() => pick(s)}
              onMouseEnter={() => setActive(i)}
              className="w-full px-3 py-2 text-left text-sm transition"
              style={{
                color: 'var(--color-text)',
                background: i === active ? 'var(--color-bg)' : 'transparent',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
