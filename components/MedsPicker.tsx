'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadIal,
  getIalDataSync,
  searchIal,
  totalOptions,
  type IalEntry,
  type SearchHit,
} from '@/lib/ial-meds';
import type { Medication } from '@/lib/types';

interface MedsPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onPick: (med: Medication) => void;
}

export default function MedsPicker({
  isOpen,
  onClose,
  onPick,
}: MedsPickerProps) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<IalEntry[] | null>(getIalDataSync());
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [expandedInn, setExpandedInn] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setExpandedInn(null);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || data) return;
    setLoadErr(null);
    let cancelled = false;
    loadIal()
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .catch((e: Error) => {
        if (!cancelled)
          setLoadErr(e.message || 'Грешка при зареждане на ИАЛ');
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, data]);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Empty query → most option-rich drugs first (rough usage proxy)
  const hits: SearchHit[] = useMemo(() => {
    if (!data) return [];
    if (!query.trim()) {
      return [...data]
        .sort((a, b) => totalOptions(b) - totalOptions(a))
        .slice(0, 30)
        .map((entry) => ({ entry, matchKind: 'inn-prefix' as const }));
    }
    return searchIal(query, 100);
  }, [data, query]);

  const handlePickMed = useCallback(
    (med: Medication) => {
      onPick(med);
      onClose();
    },
    [onPick, onClose]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(31, 20, 24, 0.55)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-2xl max-w-2xl w-full flex flex-col"
        style={{ background: 'var(--color-bg-card)', maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="p-5 border-b flex items-center gap-3"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex-1 min-w-0">
            <div
              className="font-medium text-base font-[family-name:var(--font-cormorant)]"
              style={{ color: 'var(--color-text)' }}
            >
              Избор на лекарство
            </div>
            {data && (
              <div
                className="text-xs mt-0.5"
                style={{ color: 'var(--color-text-hint)' }}
              >
                {data.length.toLocaleString('bg-BG')} INN от ИАЛ ·{' '}
                {data.filter((d) => !d.r).length} БЛП
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Затвори"
            className="text-2xl leading-none w-8 h-8 flex items-center justify-center rounded transition hover:bg-[var(--color-bg)]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            ×
          </button>
        </div>

        <div
          className="p-4 border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setExpandedInn(null);
            }}
            placeholder={
              data
                ? 'Латиница или кирилица: Ибупрофен, Нурофен, Lisinopril...'
                : 'Зарежда се ИАЛ регистър...'
            }
            disabled={!data}
            className="w-full px-3 py-2 rounded-md border outline-none text-sm disabled:opacity-50"
            style={{
              borderColor: 'var(--color-border-mid)',
              background: 'white',
            }}
          />
          {data && (
            <div
              className="text-xs mt-2"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {query.trim()
                ? `${hits.length} ${hits.length === 1 ? 'резултат' : 'резултата'}`
                : 'Най-често предписвани'}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {!data && !loadErr && <LoadingView />}
          {loadErr && (
            <ErrorView
              message={loadErr}
              onRetry={() => {
                setData(null);
                setLoadErr(null);
              }}
            />
          )}
          {data && hits.length === 0 && query.trim() && (
            <EmptyResultsView
              query={query}
              onAddManual={() => handlePickMed({ inn: query.trim() })}
            />
          )}
          {data && hits.length > 0 && (
            <div className="p-2">
              {hits.map((hit) => (
                <MedRow
                  key={hit.entry.i}
                  entry={hit.entry}
                  matchKind={hit.matchKind}
                  expanded={expandedInn === hit.entry.i}
                  onToggleExpand={() =>
                    setExpandedInn(
                      expandedInn === hit.entry.i ? null : hit.entry.i
                    )
                  }
                  onCommit={handlePickMed}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */

function LoadingView() {
  return (
    <div
      className="p-8 text-center text-sm"
      style={{ color: 'var(--color-text-muted)' }}
    >
      <div className="inline-flex items-center gap-2">
        <span
          className="inline-block w-3 h-3 rounded-full animate-pulse"
          style={{ background: 'var(--color-brand)' }}
        />
        Зарежда се ИАЛ регистър...
      </div>
      <div
        className="text-xs mt-2"
        style={{ color: 'var(--color-text-hint)' }}
      >
        ~80 KB, кешира се след първото зареждане
      </div>
    </div>
  );
}

function ErrorView({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="p-8 text-center">
      <div className="text-sm mb-3" style={{ color: 'var(--color-red)' }}>
        Грешка при зареждане на ИАЛ регистър
        {message && (
          <div
            className="text-xs mt-1 font-[family-name:var(--font-jetbrains)]"
            style={{ color: 'var(--color-text-hint)' }}
          >
            {message}
          </div>
        )}
      </div>
      <button
        onClick={onRetry}
        className="px-4 py-2 rounded-md text-sm text-white transition hover:opacity-90"
        style={{ background: 'var(--color-brand)' }}
      >
        Опитай отново
      </button>
    </div>
  );
}

function EmptyResultsView({
  query,
  onAddManual,
}: {
  query: string;
  onAddManual: () => void;
}) {
  return (
    <div
      className="p-8 text-center text-sm"
      style={{ color: 'var(--color-text-muted)' }}
    >
      Няма резултати за <strong>{query}</strong>
      <div
        className="text-xs mt-2 mb-4"
        style={{ color: 'var(--color-text-hint)' }}
      >
        Опитайте с друго изписване (латиница ↔ кирилица) или добавете ръчно:
      </div>
      <button
        onClick={onAddManual}
        className="px-4 py-2 rounded-md text-sm text-white transition hover:opacity-90"
        style={{ background: 'var(--color-brand)' }}
      >
        + Добави &quot;{query}&quot; ръчно
      </button>
    </div>
  );
}

function MedRow({
  entry,
  matchKind,
  expanded,
  onToggleExpand,
  onCommit,
}: {
  entry: IalEntry;
  matchKind: SearchHit['matchKind'];
  expanded: boolean;
  onToggleExpand: () => void;
  onCommit: (med: Medication) => void;
}) {
  return (
    <div
      className="rounded-md mb-1 transition"
      style={{
        background: expanded ? 'var(--color-brand-light)' : 'transparent',
      }}
    >
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-md hover:bg-[var(--color-bg)] transition"
      >
        <div className="flex-1 min-w-0">
          <div
            className="text-sm font-medium leading-tight truncate"
            style={{ color: 'var(--color-text)' }}
          >
            {entry.b}
          </div>
          <div
            className="text-[11px] mt-0.5 truncate font-[family-name:var(--font-jetbrains)]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {entry.i}
            {entry.a ? ' · ' + entry.a : ''}
            {matchKind === 'brand' ? ' · търговско име' : ''}
          </div>
        </div>
        <Badge rx={entry.r} />
        <span
          className="text-xs flex-shrink-0"
          style={{ color: 'var(--color-text-hint)' }}
        >
          {expanded ? '▴' : '▾'}
        </span>
      </button>

      {expanded && <ExpandedForm entry={entry} onCommit={onCommit} />}
    </div>
  );
}

function ExpandedForm({
  entry,
  onCommit,
}: {
  entry: IalEntry;
  onCommit: (med: Medication) => void;
}) {
  const forms = useMemo(() => Object.keys(entry.fd), [entry.fd]);
  const [form, setForm] = useState<string>(forms[0] || '');
  // Doses for the currently-selected form
  const doses = useMemo(
    () => (form ? entry.fd[form] || [] : []),
    [entry.fd, form]
  );
  const [dose, setDose] = useState<string>(doses[0] || '');

  // When form changes, reset dose to first option of new form
  useEffect(() => {
    setDose(doses[0] || '');
  }, [form, doses]);

  const [regimen, setRegimen] = useState('');

  function commit() {
    onCommit({
      inn: entry.b, // Bulgarian as primary display
      dose: dose || undefined,
      regimen: regimen.trim() || undefined,
      route: form || undefined,
    });
  }

  return (
    <div
      className="px-3 pb-3 pt-1 space-y-2 border-t"
      style={{ borderColor: 'var(--color-border)' }}
    >
      {forms.length === 0 ? (
        <div
          className="text-xs italic py-2"
          style={{ color: 'var(--color-text-hint)' }}
        >
          Няма данни за форма/доза от ИАЛ — въведете ръчно по-долу.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              className="block text-[10px] uppercase tracking-wider mb-1 font-semibold"
              style={{ color: 'var(--color-text-hint)' }}
            >
              Форма
              {forms.length > 1 && (
                <span
                  className="ml-1 normal-case font-normal"
                  style={{ color: 'var(--color-text-hint)' }}
                >
                  ({forms.length})
                </span>
              )}
            </label>
            {forms.length === 1 ? (
              <div
                className="px-2 py-1.5 rounded text-sm border bg-white"
                style={{
                  borderColor: 'var(--color-border-light)',
                  color: 'var(--color-text)',
                }}
              >
                {forms[0]}
              </div>
            ) : (
              <select
                value={form}
                onChange={(e) => setForm(e.target.value)}
                className="w-full px-2 py-1.5 rounded text-sm border outline-none bg-white"
                style={{ borderColor: 'var(--color-border-mid)' }}
              >
                {forms.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label
              className="block text-[10px] uppercase tracking-wider mb-1 font-semibold"
              style={{ color: 'var(--color-text-hint)' }}
            >
              Доза
              {doses.length > 1 && (
                <span
                  className="ml-1 normal-case font-normal"
                  style={{ color: 'var(--color-text-hint)' }}
                >
                  ({doses.length})
                </span>
              )}
            </label>
            {doses.length === 1 ? (
              <div
                className="px-2 py-1.5 rounded text-sm border bg-white truncate"
                style={{
                  borderColor: 'var(--color-border-light)',
                  color: 'var(--color-text)',
                }}
                title={doses[0]}
              >
                {doses[0]}
              </div>
            ) : (
              <select
                value={dose}
                onChange={(e) => setDose(e.target.value)}
                className="w-full px-2 py-1.5 rounded text-sm border outline-none bg-white"
                style={{ borderColor: 'var(--color-border-mid)' }}
              >
                {doses.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      <div>
        <label
          className="block text-[10px] uppercase tracking-wider mb-1 font-semibold"
          style={{ color: 'var(--color-text-hint)' }}
        >
          Прием
        </label>
        <input
          type="text"
          value={regimen}
          onChange={(e) => setRegimen(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          placeholder="например 1 т. 3 пъти дневно × 7 дни"
          className="w-full px-2 py-1.5 rounded text-sm border outline-none"
          style={{ borderColor: 'var(--color-border-mid)' }}
        />
      </div>

      <button
        onClick={commit}
        className="w-full py-2 rounded-md text-sm font-medium text-white transition hover:opacity-90"
        style={{ background: 'var(--gradient-brand)' }}
      >
        + Добави в плана
      </button>
    </div>
  );
}

function Badge({ rx }: { rx: boolean }) {
  return (
    <span
      className="text-[10px] font-bold px-2 py-1 rounded flex-shrink-0"
      style={{
        background: rx ? 'var(--color-brand)' : 'var(--color-ok-soft)',
        color: rx ? 'white' : 'var(--color-ok)',
      }}
      title={rx ? 'Изисква рецепта' : 'Без лекарско предписание'}
    >
      {rx ? 'Rx' : 'БЛП'}
    </span>
  );
}
