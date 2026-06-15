'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  MKB_CHAPTERS,
  loadMkb,
  getMkbDataSync,
  searchMkb,
  rowsInChapter,
  chapterCounts,
  findByCode,
  type MkbRow,
} from '@/lib/mkb10';
import { getPinned, togglePin } from '@/lib/mkb-pins';

// Stable no-op subscribe for useSyncExternalStore — the `mounted` flag flips once
// (server/hydration snapshot false → client true) and never emits store updates,
// so the subscriber is a permanent no-op. Same idiom as app/app/login/page.tsx.
const subscribeNoop = () => () => {};

interface MkbPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onPick: (code: string, term: string) => void;
  initialQuery?: string;
  title?: string;
}

export default function MkbPicker({
  isOpen,
  onClose,
  onPick,
  initialQuery = '',
  title,
}: MkbPickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [chapterIdx, setChapterIdx] = useState<number | null>(null);
  const [data, setData] = useState<MkbRow[] | null>(getMkbDataSync());
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // The overlay is portaled to document.body so its `position: fixed` resolves
  // against the VIEWPORT, not a transformed ancestor. This picker mounts inside a
  // `.nv-card-enter` SectionCard whose entrance animation applies a `transform`,
  // which makes that card the containing block for fixed-position descendants —
  // trapping (and clipping) the modal in the card's box instead of centering it on
  // screen. Portaling out is the same fix the DOB calendar popover uses
  // (components/ui/DateInputBg.tsx). `mounted` is false on the server + hydration
  // snapshot and true on the client, so createPortal never touches document.body
  // during SSR; useSyncExternalStore (not useEffect+setState) keeps that
  // hydration-safe AND clear of the react-hooks/set-state-in-effect rule.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);

  // Reset state, load pins, focus search on open
  useEffect(() => {
    if (!isOpen) return;
    setQuery(initialQuery);
    setChapterIdx(null);
    setPinned(getPinned());
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [isOpen, initialQuery]);

  // Lazy-load MKB data on first open
  useEffect(() => {
    if (!isOpen || data) return;
    setLoadErr(null);
    let cancelled = false;
    loadMkb()
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .catch((e: Error) => {
        if (!cancelled)
          setLoadErr(e.message || 'Грешка при зареждане на МКБ-10');
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, data]);

  // Esc to close
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const handleTogglePin = useCallback((code: string) => {
    setPinned(togglePin(code));
  }, []);

  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);

  const pinnedRows: MkbRow[] = useMemo(() => {
    if (!data || pinned.length === 0) return [];
    return pinned
      .map((c) => findByCode(data, c))
      .filter((r): r is MkbRow => !!r);
  }, [data, pinned]);

  if (!isOpen) return null;

  // ── Decide view mode ─────────────────────────────────────
  let rows: MkbRow[] = [];
  let viewMode: 'chapters' | 'rows' | 'loading' | 'error' = 'chapters';

  if (loadErr) {
    viewMode = 'error';
  } else if (!data) {
    viewMode = 'loading';
  } else if (query.trim()) {
    rows = searchMkb(data, query, 300);
    viewMode = 'rows';
  } else if (chapterIdx !== null) {
    rows = rowsInChapter(data, chapterIdx);
    viewMode = 'rows';
  }

  function pick(row: MkbRow) {
    onPick(row[0], row[1]);
    onClose();
  }

  const overlay = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(31, 20, 24, 0.55)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-2xl max-w-2xl w-full flex flex-col"
        style={{ background: 'var(--color-bg-card)', maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="p-5 border-b flex items-center gap-3"
          style={{ borderColor: 'var(--color-border)' }}
        >
          {chapterIdx !== null && !query.trim() && (
            <button
              onClick={() => setChapterIdx(null)}
              className="text-sm hover:underline whitespace-nowrap"
              style={{ color: 'var(--color-brand)' }}
            >
              ← Глави
            </button>
          )}
          <div className="flex-1 min-w-0">
            <div
              className="font-semibold text-base"
              style={{ color: 'var(--color-ink)' }}
            >
              {title || 'Избор на МКБ-10 код'}
            </div>
            {chapterIdx !== null && !query.trim() && data && (
              <div
                className="text-xs mt-0.5 truncate"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {MKB_CHAPTERS[chapterIdx].name}
              </div>
            )}
            {data && !chapterIdx && !query.trim() && (
              <div
                className="text-xs mt-0.5"
                style={{ color: 'var(--color-text-hint)' }}
              >
                {data.length.toLocaleString('bg-BG')} кода · 22 глави
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

        {/* Search */}
        <div
          className="p-4 border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              data
                ? 'Търсене сред 10 990 кода...'
                : 'Зарежда се...'
            }
            disabled={!data}
            className="w-full px-3 py-2 rounded-md border outline-none text-sm disabled:opacity-50"
            style={{
              borderColor: 'var(--color-border-mid)',
              background: 'white',
            }}
          />
          {viewMode === 'rows' && (
            <div
              className="text-xs mt-2"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {rows.length} {rows.length === 1 ? 'резултат' : 'резултата'}
              {rows.length === 300 && ' (показани първите 300)'}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {viewMode === 'loading' && <LoadingView />}
          {viewMode === 'error' && (
            <ErrorView
              message={loadErr || ''}
              onRetry={() => {
                setData(null);
                setLoadErr(null);
              }}
            />
          )}
          {viewMode === 'chapters' && data && (
            <>
              {pinnedRows.length > 0 && (
                <PinnedSection
                  rows={pinnedRows}
                  pinnedSet={pinnedSet}
                  onPick={pick}
                  onTogglePin={handleTogglePin}
                />
              )}
              <ChapterList data={data} onPick={setChapterIdx} />
            </>
          )}
          {viewMode === 'rows' && (
            <RowList
              rows={rows}
              query={query}
              pinnedSet={pinnedSet}
              onPick={pick}
              onTogglePin={handleTogglePin}
            />
          )}
        </div>
      </div>
    </div>
  );

  return mounted ? createPortal(overlay, document.body) : null;
}

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
        Зарежда се пълният МКБ-10 списък...
      </div>
      <div
        className="text-xs mt-2"
        style={{ color: 'var(--color-text-hint)' }}
      >
        ~1 MB, кешира се след първото зареждане
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
      <div
        className="text-sm mb-3"
        style={{ color: 'var(--color-red)' }}
      >
        Грешка при зареждане на МКБ-10
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

function PinnedSection({
  rows,
  pinnedSet,
  onPick,
  onTogglePin,
}: {
  rows: MkbRow[];
  pinnedSet: Set<string>;
  onPick: (row: MkbRow) => void;
  onTogglePin: (code: string) => void;
}) {
  return (
    <div
      className="border-b"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div
        className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wider font-semibold flex items-center gap-1"
        style={{ color: 'var(--color-gold)' }}
      >
        <span>★ Закачени</span>
        <span
          className="text-[10px] font-normal"
          style={{ color: 'var(--color-text-hint)' }}
        >
          ({rows.length})
        </span>
      </div>
      <div className="p-2">
        {rows.map((r) => (
          <RowItem
            key={r[0]}
            row={r}
            pinned={pinnedSet.has(r[0])}
            onPick={onPick}
            onTogglePin={onTogglePin}
          />
        ))}
      </div>
    </div>
  );
}

function ChapterList({
  data,
  onPick,
}: {
  data: MkbRow[];
  onPick: (idx: number) => void;
}) {
  const counts = chapterCounts(data);
  return (
    <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
      {MKB_CHAPTERS.map((ch, i) => (
        <button
          key={ch.range}
          onClick={() => onPick(i)}
          className="text-left p-3 rounded-lg transition hover:opacity-80 flex items-center gap-3"
          style={{ background: ch.bgColor, color: ch.textColor }}
        >
          <span
            className="font-[family-name:var(--font-jetbrains)] text-[10px] px-2 py-1 rounded font-semibold flex-shrink-0"
            style={{ background: 'white', color: ch.fgColor }}
          >
            {ch.range}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-tight">{ch.name}</div>
            <div className="text-[11px] opacity-70 mt-0.5">
              {counts[i].toLocaleString('bg-BG')} кода
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function RowList({
  rows,
  query,
  pinnedSet,
  onPick,
  onTogglePin,
}: {
  rows: MkbRow[];
  query: string;
  pinnedSet: Set<string>;
  onPick: (row: MkbRow) => void;
  onTogglePin: (code: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div
        className="p-8 text-center text-sm"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Няма резултати за <strong>{query}</strong>
      </div>
    );
  }
  return (
    <div className="p-2">
      {rows.map((r) => (
        <RowItem
          key={r[0]}
          row={r}
          query={query}
          pinned={pinnedSet.has(r[0])}
          onPick={onPick}
          onTogglePin={onTogglePin}
        />
      ))}
    </div>
  );
}

function RowItem({
  row,
  query,
  pinned,
  onPick,
  onTogglePin,
}: {
  row: MkbRow;
  query?: string;
  pinned: boolean;
  onPick: (row: MkbRow) => void;
  onTogglePin: (code: string) => void;
}) {
  const ch = MKB_CHAPTERS[row[2]];
  return (
    <div className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition hover:bg-[var(--color-bg)] group">
      <button
        onClick={() => onPick(row)}
        className="flex-1 flex items-center gap-3 text-left min-w-0"
      >
        <span
          className="font-[family-name:var(--font-jetbrains)] text-[11px] px-2 py-1 rounded font-semibold flex-shrink-0 text-center"
          style={{
            background: ch.bgColor,
            color: ch.fgColor,
            minWidth: '68px',
          }}
        >
          {row[0]}
        </span>
        <span
          className="text-sm flex-1 min-w-0 truncate"
          style={{ color: 'var(--color-text)' }}
        >
          {query ? highlightMatch(row[1], query) : row[1]}
        </span>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin(row[0]);
        }}
        aria-label={pinned ? 'Откачи' : 'Закачи'}
        title={pinned ? 'Откачи от любими' : 'Закачи в любими'}
        className="w-7 h-7 flex items-center justify-center rounded transition flex-shrink-0 hover:bg-[var(--color-brand-soft)]"
        style={{
          color: pinned ? 'var(--color-gold)' : 'var(--color-text-hint)',
          opacity: pinned ? 1 : 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
        onFocus={(e) => (e.currentTarget.style.opacity = '1')}
      >
        {pinned ? '★' : '☆'}
      </button>
      <style jsx>{`
        div:hover > button:last-of-type {
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
}

function highlightMatch(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark
        style={{
          background: 'var(--color-brand-soft)',
          color: 'var(--color-brand)',
          padding: '0 2px',
          borderRadius: '2px',
        }}
      >
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}
