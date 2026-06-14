'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DayPicker } from 'react-day-picker';
import { bg } from 'date-fns/locale';
import { isoToBgInput, bgInputToIso, isRealIsoDate } from '@/lib/date';
import 'react-day-picker/style.css';

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

// ISO `YYYY-MM-DD` → a local Date (midday, to dodge DST/timezone edges), or
// undefined when the string isn't a real calendar day.
function isoToDate(iso: string): Date | undefined {
  if (!isRealIsoDate(iso)) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

// Local Date → ISO `YYYY-MM-DD`, read from local parts (NOT toISOString, which
// would shift the day across the UTC boundary).
function dateToIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Anchor point for the popover: document coordinates of the field's bottom-right.
// Document coords (+ scrollX/Y) mean the absolutely-positioned, body-portaled
// popover scrolls WITH the page (never clipped off-screen), and translateX(-100%)
// right-aligns it under the field's right edge (where the calendar icon sits).
function anchorOf(el: HTMLElement): { top: number; left: number } {
  const r = el.getBoundingClientRect();
  return { top: r.bottom + window.scrollY + 6, left: r.right + window.scrollX };
}

const RDP_VARS = {
  '--rdp-accent-color': 'var(--color-accent)',
  '--rdp-accent-background-color': 'var(--color-accent-soft)',
  '--rdp-today-color': 'var(--color-accent)',
  '--rdp-day-width': '38px',
  '--rdp-day-height': '38px',
  '--rdp-day_button-width': '36px',
  '--rdp-day_button-height': '36px',
  '--rdp-disabled-opacity': '0.35',
  '--rdp-nav-height': '2.4rem',
  '--rdp-nav_button-width': '2rem',
  '--rdp-nav_button-height': '2rem',
} as React.CSSProperties;

/**
 * Typed, masked ДД.ММ.ГГГГ birth-date field, plus an additive calendar popover.
 * Typing is the primary path and is unchanged: the parent owns the canonical ISO
 * value (state.birth_date); this holds only the local masked text and translates
 * both ways via lib/date. The calendar (react-day-picker, brand-themed) is the
 * second way to pick — a day click flows through the SAME onChange(iso) as typing,
 * so age derivation / dobError / the red border all keep working untouched. The
 * year dropdown jumps to any birth year in a click or two; future dates are
 * disabled; bg locale, Monday-start.
 *
 * The popover is PORTALED to <body>: the form's section cards each form a stacking
 * context (the .nv-card-enter transform), so an in-card absolute popover would be
 * painted over by the next card — portaling floats it above everything.
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
  // masked text WITHOUT clobbering an in-progress entry — render-phase idiom
  // (deliberately not a useEffect / ref; react-compiler-safe). See C3.
  const [lastEmitted, setLastEmitted] = useState(value);
  if (value !== lastEmitted) {
    setLastEmitted(value);
    setText(isoToBgInput(value));
  }

  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function openCalendar() {
    if (wrapperRef.current) setAnchor(anchorOf(wrapperRef.current));
    setOpen(true);
  }

  // Close on outside-click / Escape; keep the popover anchored on resize. The
  // effect ONLY adds/removes listeners (the setState lives in the callbacks, never
  // synchronously in the body) — the shape react-compiler allows. Outside-click
  // must consider BOTH the field wrapper and the (portaled) popover.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapperRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    }
    function onResize() {
      if (wrapperRef.current) setAnchor(anchorOf(wrapperRef.current));
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const masked = maskBgDate(e.target.value);
    setText(masked);
    const iso = bgInputToIso(masked);
    setLastEmitted(iso);
    onChange(iso);
  }

  function handleSelect(date: Date | undefined) {
    if (!date) return; // re-clicking the selected day deselects — keep the value
    const iso = dateToIso(date);
    setText(isoToBgInput(iso));
    setLastEmitted(iso);
    onChange(iso);
    setOpen(false);
  }

  const today = useMemo(() => new Date(), []);
  const startMonth = useMemo(() => new Date(1900, 0), []);
  const disabledAfterToday = useMemo(() => ({ after: today }), [today]);
  const selectedDate = useMemo(() => isoToDate(value), [value]);
  // Open to the entered date, else a plausible adult year so the year dropdown
  // lands somewhere sensible rather than on the current year.
  const defaultMonth = useMemo(
    () => selectedDate ?? new Date(today.getFullYear() - 30, 0),
    [selectedDate, today],
  );

  return (
    <span ref={wrapperRef} className="relative block">
      <input
        id={id}
        className={`${className ?? ''} pr-10`.trim()}
        value={text}
        onChange={handleChange}
        inputMode="numeric"
        placeholder={placeholder}
        maxLength={10}
        aria-invalid={ariaInvalid}
      />
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openCalendar())}
        className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-md transition-colors"
        style={{ width: 32, height: 32, color: 'var(--color-text-muted)' }}
        aria-label="Изберете дата от календар"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Календар"
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-soft)'; e.currentTarget.style.color = 'var(--color-accent)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2.5v3M16 2.5v3" />
        </svg>
      </button>

      {open && anchor && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Календар за дата на раждане"
          className="dob-cal p-2"
          style={{
            position: 'absolute',
            top: anchor.top,
            left: anchor.left,
            transform: 'translateX(-100%)',
            zIndex: 1000,
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-pop)',
          }}
        >
          <DayPicker
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
            defaultMonth={defaultMonth}
            startMonth={startMonth}
            endMonth={today}
            captionLayout="dropdown"
            disabled={disabledAfterToday}
            locale={bg}
            weekStartsOn={1}
            style={RDP_VARS}
          />
        </div>,
        document.body,
      )}
    </span>
  );
}
