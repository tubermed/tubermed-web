'use client';

// Inline МКБ-10 typeahead — ONE shared control used wherever a diagnosis is set
// or changed (main diagnosis AND every comorbidity), for both adding and
// changing. Search is fully CLIENT-SIDE over the already-loaded public/mkb10.json
// (no API, no backend round-trip). Picking a suggestion sets code + official term
// together, so the recorded diagnosis can never be free-text hallucination.

import { useEffect, useRef, useState } from 'react';
import { loadMkb, getMkbDataSync, searchMkb, type MkbRow } from '@/lib/mkb10';
import { Icon } from '@/components/ui/Icon';

interface MkbTypeaheadProps {
  /** Current code ('' when none yet). */
  code: string;
  /** Current resolved term to show when not searching (official term or fallback). */
  term: string;
  /** Reconcile styling — the current code is invalid/missing. */
  invalid?: boolean;
  /** Open directly in search mode (search-first comorbidity add / a fresh pick). */
  startInSearch?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** A suggestion was picked → set code + official term together. */
  onPick: (code: string, term: string) => void;
  /** Search dismissed with no committed value (e.g. comorbidity add cancelled) →
   *  caller should add NO empty row. Only meaningful when startInSearch. */
  onCancel?: () => void;
  /** Explicit remove (✕). */
  onRemove?: () => void;
  /** Open the full МКБ browser (chapters + pinned) — reuses the existing modal. */
  onBrowse?: () => void;
}

export default function MkbTypeahead({
  code,
  term,
  invalid = false,
  startInSearch = false,
  placeholder = 'Търсене на диагноза или МКБ код…',
  disabled = false,
  onPick,
  onCancel,
  onRemove,
  onBrowse,
}: MkbTypeaheadProps) {
  const [searching, setSearching] = useState(startInSearch);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<MkbRow[] | null>(getMkbDataSync());
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lazy-load the nomenclature (cached after first load anywhere in the app).
  useEffect(() => {
    if (data) return;
    let cancelled = false;
    loadMkb().then((rows) => { if (!cancelled) setData(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, [data]);

  useEffect(() => {
    if (searching) {
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
  }, [searching]);

  const results: MkbRow[] = searching && data && query.trim()
    ? searchMkb(data, query, 30)
    : [];

  function enterSearch() {
    if (disabled) return;
    setQuery('');
    setSearching(true);
  }

  function dismiss() {
    setSearching(false);
    setQuery('');
    // A fresh add (no prior code) that was cancelled → tell the caller to drop it.
    if (startInSearch && !code && onCancel) onCancel();
  }

  function pick(row: MkbRow) {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    onPick(row[0], row[1]);
    setSearching(false);
    setQuery('');
  }

  // ── Search mode ──
  if (searching) {
    return (
      <div className="relative flex-1">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          onBlur={() => { blurTimer.current = setTimeout(dismiss, 150); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); dismiss(); } }}
          className="w-full px-3 py-2 rounded-md border outline-none text-base"
          style={{ borderColor: 'var(--color-brand)', background: 'white' }}
        />
        {query.trim() && (
          <div
            className="absolute left-0 right-0 top-full mt-1 z-30 rounded-md border shadow-lg overflow-y-auto"
            style={{ background: 'white', borderColor: 'var(--color-border)', maxHeight: '320px' }}
            // keep focus on the input while clicking a row
            onMouseDown={(e) => e.preventDefault()}
          >
            {!data && (
              <div className="px-3 py-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Зарежда се МКБ-10…
              </div>
            )}
            {data && results.length === 0 && (
              <div className="px-3 py-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Няма резултати за <strong>{query}</strong>
              </div>
            )}
            {results.map((r) => (
              <button
                key={r[0]}
                type="button"
                onClick={() => pick(r)}
                className="w-full flex items-center gap-3 px-3 py-2 text-left transition hover:bg-[var(--color-bg)]"
              >
                <span
                  className="font-[family-name:var(--font-jetbrains)] text-[11px] px-2 py-1 rounded font-semibold flex-shrink-0 text-center"
                  style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)', minWidth: '64px' }}
                >
                  {r[0]}
                </span>
                <span className="text-sm" style={{ color: 'var(--color-text)' }}>{r[1]}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Resolved (display) mode ──
  const hasValue = !!(code || term);
  return (
    <div className="flex items-center gap-2 flex-1">
      <button
        type="button"
        onClick={enterSearch}
        disabled={disabled}
        className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md border text-left transition hover:bg-[var(--color-bg)] disabled:opacity-60"
        style={{
          borderColor: invalid ? 'var(--color-red)' : 'var(--color-border-mid)',
          background: 'white',
        }}
        title="Натиснете за търсене/промяна на диагнозата"
      >
        {hasValue ? (
          <>
            <span
              className="font-[family-name:var(--font-jetbrains)] text-[11px] px-2 py-1 rounded font-semibold flex-shrink-0"
              style={{
                background: invalid ? 'var(--color-red-soft)' : 'var(--color-brand-soft)',
                color: invalid ? 'var(--color-red)' : 'var(--color-brand)',
                minWidth: '64px',
                textAlign: 'center',
              }}
            >
              {code || '—'}
            </span>
            <span className="text-base flex-1 min-w-0" style={{ color: 'var(--color-ink)' }}>
              {term || <span style={{ color: 'var(--color-text-hint)' }}>Изберете диагноза</span>}
            </span>
          </>
        ) : (
          <span className="text-base" style={{ color: 'var(--color-text-hint)' }}>{placeholder}</span>
        )}
        <Icon name="pencil" className="flex-shrink-0" style={{ color: 'var(--color-text-hint)' }} />
      </button>
      {onBrowse && (
        <button
          type="button"
          onClick={onBrowse}
          disabled={disabled}
          aria-label="Преглед на всички МКБ-10 кодове"
          title="Преглед по глави / закачени"
          className="w-9 h-9 flex items-center justify-center rounded border transition flex-shrink-0 hover:bg-[var(--color-bg)] disabled:opacity-40"
          style={{ borderColor: 'var(--color-border-mid)', color: 'var(--color-text-muted)' }}
        >
          <Icon name="search" />
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label="Премахни"
          title="Премахни"
          className="w-8 h-8 flex items-center justify-center rounded transition flex-shrink-0 hover:bg-[var(--color-red-soft)] disabled:opacity-40"
          style={{ color: 'var(--color-text-hint)' }}
        >
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}
