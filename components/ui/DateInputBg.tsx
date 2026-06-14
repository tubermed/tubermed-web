'use client';

import { useState } from 'react';
import { isoToBgInput, bgInputToIso } from '@/lib/date';

interface DateInputBgProps {
  /** Controlled value as ISO `YYYY-MM-DD` (or '' for empty). */
  value: string;
  /** Emits ISO `YYYY-MM-DD` for a complete, real date; '' for empty / partial. */
  onChange: (iso: string) => void;
  id?: string;
  className?: string;
  placeholder?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}

// Auto-insert dots while typing: keep at most 8 digits, format as DD.MM.YYYY.
// Stripping non-digits then re-masking also makes backspacing over a dot behave.
function maskBgDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`;
}

/**
 * Typed, masked ДД.ММ.ГГГГ birth-date field. No calendar popup — a DOB is a known
 * value, so typing beats scrolling back decades. The parent owns the canonical
 * ISO value (state.birth_date); this holds only the local masked display text and
 * translates both ways via lib/date. Anything partial / incomplete emits '' so the
 * age readout and DOB validation don't flicker mid-typing.
 */
export default function DateInputBg({
  value,
  onChange,
  id,
  className,
  placeholder = 'ДД.ММ.ГГГГ',
  'aria-invalid': ariaInvalid,
}: DateInputBgProps) {
  const [text, setText] = useState(() => isoToBgInput(value));
  // Reflect EXTERNAL value changes (ЕГН auto-fill, × Изчисти, name-load) into the
  // masked text WITHOUT clobbering an in-progress entry: `lastEmitted` is the ISO
  // this field last produced, so the parent echoing it straight back is a no-op
  // while a genuinely new external value re-seeds the display. This is React's
  // "adjust state when a prop changes" render-phase idiom — deliberately NOT a
  // useEffect (react-compiler forbids synchronous setState in effects) and NOT a
  // ref (render-time ref writes are banned too).
  const [lastEmitted, setLastEmitted] = useState(value);
  if (value !== lastEmitted) {
    setLastEmitted(value);
    setText(isoToBgInput(value));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const masked = maskBgDate(e.target.value);
    setText(masked);
    const iso = bgInputToIso(masked);
    setLastEmitted(iso);
    onChange(iso);
  }

  return (
    <input
      id={id}
      className={className}
      value={text}
      onChange={handleChange}
      inputMode="numeric"
      placeholder={placeholder}
      maxLength={10}
      aria-invalid={ariaInvalid}
    />
  );
}
