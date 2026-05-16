'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { PatientSearchHit, PatientSearchResponse } from '@/lib/types';

interface PatientSearchProps {
  /** Called when the doctor picks a row from the dropdown. */
  onPick: (hit: PatientSearchHit) => void;
  /** Called when the doctor clicks "+ Създай нов пациент" in the zero-state. */
  onCreateNew?: (prefilledQuery: string) => void;
  placeholder?: string;
  /** Optional preselected patient display label; clears on focus. */
  selectedLabel?: string | null;
  onClearSelection?: () => void;
}

const DEBOUNCE_MS = 220;

export default function PatientSearch({
  onPick,
  onCreateNew,
  placeholder = 'Търси пациент по име или ЕГН',
  selectedLabel,
  onClearSelection,
}: PatientSearchProps) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PatientSearchHit[]>([]);
  const [match, setMatch] = useState<PatientSearchResponse['match']>('none');
  const [hint, setHint] = useState<string | null>(null);
  const reqIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef  = useRef<HTMLDivElement | null>(null);

  // Debounced search
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResults([]); setHint(null); setMatch('none'); setLoading(false);
      return;
    }
    setLoading(true);
    const myId = ++reqIdRef.current;
    const t = setTimeout(async () => {
      try {
        const data = await api.searchPatients(query, 10);
        if (myId !== reqIdRef.current) return;            // stale response
        setResults(data.patients);
        setMatch(data.match);
        setHint(data.hint ?? null);
      } catch (err) {
        if (myId !== reqIdRef.current) return;
        setResults([]);
        setHint(err instanceof ApiError ? err.message : 'Грешка при търсене');
      } finally {
        if (myId === reqIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Close dropdown on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const handlePick = useCallback(
    (hit: PatientSearchHit) => {
      onPick(hit);
      setQ('');
      setOpen(false);
      setResults([]);
    },
    [onPick]
  );

  // If a patient is already selected at the parent level, show that as a chip
  // and let focus clear it. The dropdown is suppressed in that state.
  if (selectedLabel) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm"
          style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}
        >
          {selectedLabel}
          <button
            onClick={onClearSelection}
            aria-label="Изчисти избора"
            className="text-base leading-none opacity-70 hover:opacity-100"
          >
            ×
          </button>
        </span>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative w-full max-w-[420px]">
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-md"
        style={{ background: 'white', border: '1px solid var(--color-border-mid)' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             style={{ color: 'var(--color-text-hint)' }}>
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="flex-1 outline-none bg-transparent text-sm"
          style={{ color: 'var(--color-text)' }}
        />
        {loading && (
          <span
            className="w-3 h-3 rounded-full border-2 animate-spin"
            style={{ borderColor: 'var(--color-border-mid)', borderTopColor: 'var(--color-brand)' }}
          />
        )}
      </div>

      {open && q.trim() && (
        <div
          className="absolute left-0 right-0 mt-1 rounded-md shadow-lg z-40 overflow-hidden"
          style={{ background: 'white', border: '1px solid var(--color-border)' }}
        >
          {results.length > 0 ? (
            <ul className="max-h-[320px] overflow-y-auto">
              {results.map((hit) => (
                <li key={hit.id}>
                  <button
                    onClick={() => handlePick(hit)}
                    className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-[var(--color-brand-light)]"
                  >
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                      style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}
                    >
                      {(hit.first_name[0] || '?').toUpperCase()}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                        {[hit.first_name, hit.middle_name, hit.last_name].filter(Boolean).join(' ')}
                      </span>
                      <span className="block text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {hit.birth_date ? `р. ${hit.birth_date}` : 'без дата на раждане'}
                        {hit.national_id_last4 ? ` · ····${hit.national_id_last4}` : ''}
                        {hit.national_id_type && hit.national_id_type !== 'none' ? ` · ${hit.national_id_type.toUpperCase()}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : hint ? (
            <div className="px-3 py-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {hint}
            </div>
          ) : !loading && match === 'name_fuzzy' ? (
            <div className="px-3 py-3">
              <div className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
                Няма намерени резултати
              </div>
              {onCreateNew && (
                <button
                  onClick={() => { onCreateNew(q.trim()); setOpen(false); }}
                  className="text-sm font-medium hover:underline"
                  style={{ color: 'var(--color-brand)' }}
                >
                  + Създай нов пациент „{q.trim()}"
                </button>
              )}
            </div>
          ) : !loading ? (
            <div className="px-3 py-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Няма резултати
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
