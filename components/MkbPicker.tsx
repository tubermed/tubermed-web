'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MKB_CHAPTERS,
  searchMkb,
  rowsInChapter,
  chapterCounts,
  type MkbRow,
} from '@/lib/mkb10';

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
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state and focus search on open
  useEffect(() => {
    if (!isOpen) return;
    setQuery(initialQuery);
    setChapterIdx(null);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [isOpen, initialQuery]);

  // Esc to close
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  let rows: MkbRow[] = [];
  let viewMode: 'chapters' | 'rows' = 'chapters';

  if (query.trim()) {
    rows = searchMkb(query, 200);
    viewMode = 'rows';
  } else if (chapterIdx !== null) {
    rows = rowsInChapter(chapterIdx);
    viewMode = 'rows';
  }

  function pick(row: MkbRow) {
    onPick(row[0], row[1]);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(31, 20, 24, 0.55)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-2xl max-w-2xl w-full flex flex-col"
        style={{
          background: 'var(--color-bg-card)',
          maxHeight: '80vh',
        }}
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
              className="font-medium text-base font-[family-name:var(--font-cormorant)]"
              style={{ color: 'var(--color-text)' }}
            >
              {title || 'Избор на МКБ-10 код'}
            </div>
            {chapterIdx !== null && !query.trim() && (
              <div
                className="text-xs mt-0.5 truncate"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {MKB_CHAPTERS[chapterIdx].name}
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
            placeholder="Търсене на код или диагноза..."
            className="w-full px-3 py-2 rounded-md border outline-none text-sm"
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
            </div>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {viewMode === 'chapters' && (
            <ChapterList onPick={setChapterIdx} />
          )}
          {viewMode === 'rows' && (
            <RowList rows={rows} query={query} onPick={pick} />
          )}
        </div>
      </div>
    </div>
  );
}

function ChapterList({ onPick }: { onPick: (idx: number) => void }) {
  const counts = chapterCounts();
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
              {counts[i]} кода
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
  onPick,
}: {
  rows: MkbRow[];
  query: string;
  onPick: (row: MkbRow) => void;
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
      {rows.map((r) => {
        const ch = MKB_CHAPTERS[r[2]];
        return (
          <button
            key={r[0]}
            onClick={() => onPick(r)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition text-left hover:bg-[var(--color-bg)]"
          >
            <span
              className="font-[family-name:var(--font-jetbrains)] text-[11px] px-2 py-1 rounded font-semibold flex-shrink-0 text-center"
              style={{
                background: ch.bgColor,
                color: ch.fgColor,
                minWidth: '68px',
              }}
            >
              {r[0]}
            </span>
            <span
              className="text-sm flex-1"
              style={{ color: 'var(--color-text)' }}
            >
              {highlightMatch(r[1], query)}
            </span>
          </button>
        );
      })}
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
