'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { findHighlights, type HighlightMatch } from '@/lib/vital-rules';

interface EditableFieldProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  fieldKey?: string;
  highlightVitals?: boolean;
  /** Set of acknowledged span keys (`${fieldKey}::${raw}`). Acknowledged
   *  matches won't render as highlights. */
  acknowledged?: Set<string>;
  onAcknowledge?: (raw: string) => void;
}

export default function EditableField({
  value,
  onChange,
  placeholder = 'Не е споменато',
  fieldKey,
  highlightVitals = true,
  acknowledged,
  onAcknowledge,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);
  const [popover, setPopover] = useState<{
    match: HighlightMatch;
    rect: DOMRect;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      const t = textareaRef.current;
      t.style.height = 'auto';
      t.style.height = t.scrollHeight + 'px';
      t.focus();
      const caret = pendingCaret ?? 0;
      t.setSelectionRange(caret, caret);
      // Scroll the textarea into view if it was off-screen
      t.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setPendingCaret(null);
    }
  }, [editing, pendingCaret]);

  const allMatches = useMemo(
    () => (highlightVitals ? findHighlights(value) : []),
    [value, highlightVitals]
  );

  // Filter out acknowledged matches (doctor confirmed they're fine for patient)
  const matches = useMemo(() => {
    if (!acknowledged || !fieldKey) return allMatches;
    return allMatches.filter(
      (m) => !acknowledged.has(`${fieldKey}::${m.raw}`)
    );
  }, [allMatches, acknowledged, fieldKey]);

  function commit() {
    setEditing(false);
    if (local !== value) onChange(local);
  }

  function openEditAt(pos: number) {
    setPopover(null);
    setPendingCaret(pos);
    setEditing(true);
  }

  function handleAcknowledge(raw: string) {
    setPopover(null);
    if (onAcknowledge) onAcknowledge(raw);
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={local}
        onChange={(e) => {
          setLocal(e.target.value);
          e.currentTarget.style.height = 'auto';
          e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px';
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.currentTarget.blur();
        }}
        className="w-full px-3 py-2 rounded-md border outline-none resize-none leading-relaxed text-base"
        style={{
          borderColor: 'var(--color-brand)',
          background: 'var(--color-brand-light)',
          color: 'var(--color-text)',
          fontFamily: 'var(--font-sans)',
        }}
      />
    );
  }

  const hasContent = value.trim().length > 0;
  return (
    <>
      <div
        onClick={() => setEditing(true)}
        title="Кликни за редакция"
        className="px-3 py-2 rounded-md cursor-text leading-relaxed text-base hover:bg-[var(--color-brand-light)] transition-colors whitespace-pre-wrap"
        style={{
          color: hasContent ? 'var(--color-text)' : 'var(--color-text-hint)',
          minHeight: '38px',
        }}
      >
        {hasContent ? (
          <RenderWithSpans
            value={value}
            matches={matches}
            fieldKey={fieldKey}
            onSpanClick={(match, rect) => setPopover({ match, rect })}
          />
        ) : (
          <span className="text-sm">{placeholder}</span>
        )}
      </div>
      {popover && (
        <HighlightPopover
          match={popover.match}
          rect={popover.rect}
          onEdit={() => openEditAt(popover.match.start)}
          onAck={() => handleAcknowledge(popover.match.raw)}
          onClose={() => setPopover(null)}
        />
      )}
    </>
  );
}

function RenderWithSpans({
  value,
  matches,
  fieldKey,
  onSpanClick,
}: {
  value: string;
  matches: HighlightMatch[];
  fieldKey?: string;
  onSpanClick: (m: HighlightMatch, rect: DOMRect) => void;
}) {
  if (matches.length === 0) return <>{value}</>;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.start > cursor) out.push(value.slice(cursor, m.start));
    out.push(
      <SpanMark
        key={i}
        match={m}
        domId={fieldKey ? `vital-${fieldKey}-${i}` : undefined}
        onClick={(rect) => onSpanClick(m, rect)}
      />
    );
    cursor = m.end;
  }
  if (cursor < value.length) out.push(value.slice(cursor));
  return <>{out}</>;
}

function SpanMark({
  match,
  domId,
  onClick,
}: {
  match: HighlightMatch;
  domId?: string;
  onClick: (rect: DOMRect) => void;
}) {
  const isCritical = match.kind === 'vital-critical';
  const isUncertain = match.kind === 'uncertain';

  let style: React.CSSProperties = {
    padding: '0 2px',
    borderRadius: '3px',
    cursor: 'pointer',
    fontWeight: 500,
  };

  if (isUncertain) {
    // Word-style spell-check underline. Background subtle.
    style = {
      ...style,
      background: 'rgba(168, 132, 49, 0.08)',
      color: 'var(--color-text)',
      borderBottom: '0',
      textDecoration: 'underline wavy var(--color-gold)',
      textDecorationSkipInk: 'none',
      textUnderlineOffset: '3px',
      fontWeight: 400,
    };
  } else if (isCritical) {
    style = {
      ...style,
      background: 'rgba(192, 57, 43, 0.18)',
      color: 'var(--color-red)',
      borderBottom: '2px solid var(--color-red)',
    };
  } else {
    style = {
      ...style,
      background: 'var(--color-gold-soft)',
      color: 'var(--color-text)',
      borderBottom: '2px dashed var(--color-gold)',
    };
  }

  return (
    <mark
      id={domId}
      data-vital
      onClick={(e) => {
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onClick(rect);
      }}
      className="vital-mark"
      style={style}
    >
      {match.display}
    </mark>
  );
}

function HighlightPopover({
  match,
  rect,
  onEdit,
  onAck,
  onClose,
}: {
  match: HighlightMatch;
  rect: DOMRect;
  onEdit: () => void;
  onAck: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const isCritical = match.kind === 'vital-critical';
  const isUncertain = match.kind === 'uncertain';
  const accentColor = isCritical
    ? 'var(--color-red)'
    : isUncertain
    ? 'var(--color-gold)'
    : 'var(--color-gold)';

  // Viewport-aware positioning
  const PW = 320;
  const top = Math.min(rect.bottom + 8, window.innerHeight - 200);
  const left = Math.min(Math.max(rect.left, 8), window.innerWidth - PW - 8);

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 rounded-lg bg-white shadow-xl"
      style={{
        top,
        left,
        width: PW,
        borderColor: accentColor,
        borderWidth: 2,
        borderStyle: 'solid',
      }}
    >
      <div className="p-3">
        <div
          className="text-xs uppercase tracking-wider font-semibold mb-1.5"
          style={{ color: accentColor }}
        >
          {isCritical
            ? '🚨 Критично'
            : isUncertain
            ? '✎ Несигурно разпознаване'
            : '⚠ Извън нормата'}
        </div>
        <div
          className="text-sm leading-snug mb-3"
          style={{ color: 'var(--color-text)' }}
        >
          {match.message}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="flex-1 py-2 rounded text-sm font-medium text-white transition hover:opacity-90"
            style={{ background: 'var(--color-brand)' }}
          >
            ✎ Редактирай
          </button>
          <button
            onClick={onAck}
            className="flex-1 py-2 rounded text-sm font-medium border transition hover:bg-[var(--color-bg)]"
            style={{
              borderColor: 'var(--color-border-mid)',
              color: 'var(--color-text-muted)',
            }}
            title="Маркирай като нормално за този пациент"
          >
            ✓ Потвърди
          </button>
        </div>
      </div>
    </div>
  );
}
