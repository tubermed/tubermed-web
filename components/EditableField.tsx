'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { findHighlights, type HighlightMatch } from '@/lib/vital-rules';
import type { ResolvedUncertainSpan } from '@/lib/uncertain-spans';
import { Icon } from '@/components/ui/Icon';

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
  /** A2 — AI-uncertainty review markers for THIS field, already resolved +
   *  acknowledged-filtered by the result page (lib/uncertain-spans.ts). Rendered
   *  inline as a SECOND highlight kind ('ai-uncertain'), distinct from vitals. */
  uncertainSpans?: ResolvedUncertainSpan[];
  /** Acknowledge an uncertain span (keyed `unc::${field}::${original}` upstream). */
  onAcknowledgeUncertain?: (original: string) => void;
}

export default function EditableField({
  value,
  onChange,
  placeholder = 'Не е споменато',
  fieldKey,
  highlightVitals = true,
  acknowledged,
  onAcknowledge,
  uncertainSpans,
  onAcknowledgeUncertain,
}: EditableFieldProps) {
  // Defensive coercion. Some callers pass `undefined` at runtime even though
  // the prop is typed `string` (e.g. an extracted field that came back
  // missing, or a medication sub-field normalized to undefined). Treat
  // anything non-string as empty so `.trim()` / `.slice()` / `findHighlights`
  // never throw. Empty values still render the placeholder (and the
  // missing-field flag from MedField in MedsPanel).
  const safeValue = typeof value === 'string' ? value : '';

  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(safeValue);
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);
  const [popover, setPopover] = useState<{
    match: HighlightMatch;
    rect: DOMRect;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setLocal(safeValue);
  }, [safeValue]);

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
    () => (highlightVitals ? findHighlights(safeValue) : []),
    [safeValue, highlightVitals]
  );

  // Filter out acknowledged matches (doctor confirmed they're fine for patient)
  const matches = useMemo(() => {
    if (!acknowledged || !fieldKey) return allMatches;
    return allMatches.filter(
      (m) => !acknowledged.has(`${fieldKey}::${m.raw}`)
    );
  }, [allMatches, acknowledged, fieldKey]);

  // A2 — AI-uncertainty spans → HighlightMatch (kind 'ai-uncertain') so they
  // ride the same token-split renderer + popover as vitals. Already resolved +
  // acknowledged-filtered upstream; coords are against the CURRENT text.
  const uncertainMatches = useMemo<HighlightMatch[]>(() => {
    if (!uncertainSpans || uncertainSpans.length === 0) return [];
    return uncertainSpans.map((s) => ({
      start: s.start,
      end: s.end,
      kind: 'ai-uncertain' as const,
      raw: s.original,
      display: safeValue.slice(s.start, s.end) || s.original,
      label: 'AI несигурност',
      message: s.reason || 'Маркирано от AI за преглед.',
      suggestion: s.suggestion || undefined,
    }));
  }, [uncertainSpans, safeValue]);

  // Merge both highlight kinds into one decoration list, each carrying its own
  // DOM id (per-kind index) so the result page's review counter can target it:
  // vitals → vital-${fieldKey}-${i}, uncertain → uncertain-${fieldKey}-${j}.
  // Indices are assigned in source order BEFORE the by-start sort, so they match
  // the counter's per-field/per-kind enumeration.
  const decorations = useMemo(() => {
    const decos: { match: HighlightMatch; domId?: string }[] = [];
    matches.forEach((m, i) =>
      decos.push({ match: m, domId: fieldKey ? `vital-${fieldKey}-${i}` : undefined })
    );
    uncertainMatches.forEach((m, j) =>
      decos.push({ match: m, domId: fieldKey ? `uncertain-${fieldKey}-${j}` : undefined })
    );
    decos.sort((a, b) => a.match.start - b.match.start);
    return decos;
  }, [matches, uncertainMatches, fieldKey]);

  function commit() {
    setEditing(false);
    if (local !== safeValue) onChange(local);
  }

  function openEditAt(pos: number) {
    setPopover(null);
    setPendingCaret(pos);
    setEditing(true);
  }

  function handleAcknowledge(match: HighlightMatch) {
    setPopover(null);
    if (match.kind === 'ai-uncertain') {
      if (onAcknowledgeUncertain) onAcknowledgeUncertain(match.raw);
    } else if (onAcknowledge) {
      onAcknowledge(match.raw);
    }
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

  const hasContent = safeValue.trim().length > 0;
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
            value={safeValue}
            decorations={decorations}
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
          onAck={() => handleAcknowledge(popover.match)}
          onClose={() => setPopover(null)}
        />
      )}
    </>
  );
}

function RenderWithSpans({
  value,
  decorations,
  onSpanClick,
}: {
  value: string;
  decorations: { match: HighlightMatch; domId?: string }[];
  onSpanClick: (m: HighlightMatch, rect: DOMRect) => void;
}) {
  if (decorations.length === 0) return <>{value}</>;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < decorations.length; i++) {
    const { match: m, domId } = decorations[i];
    // Defensive: two highlight kinds can in principle overlap (a vital value and
    // an AI-uncertainty span on the same chars). Skip a span that starts before
    // the running cursor so the slicer never produces a negative/garbled range.
    if (m.start < cursor) continue;
    if (m.start > cursor) out.push(value.slice(cursor, m.start));
    out.push(
      <SpanMark
        key={i}
        match={m}
        domId={domId}
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
  const isAiUncertain = match.kind === 'ai-uncertain';

  let style: React.CSSProperties = {
    padding: '0 2px',
    borderRadius: '3px',
    cursor: 'pointer',
    fontWeight: 500,
  };

  if (isAiUncertain) {
    // A2 — AI flagged this for review. Amber DOTTED underline + soft amber wash,
    // deliberately distinct from the red/gold vital marks and the wavy
    // transcription-uncertainty mark.
    style = {
      ...style,
      background: 'rgba(183, 121, 31, 0.10)',
      color: 'var(--color-text)',
      borderBottom: '2px dotted var(--color-gold)',
      textUnderlineOffset: '3px',
    };
  } else if (isUncertain) {
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
      data-uncertain={isAiUncertain ? '' : undefined}
      data-vital={isAiUncertain ? undefined : ''}
      onClick={(e) => {
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onClick(rect);
      }}
      className={isAiUncertain ? 'uncertain-mark' : 'vital-mark'}
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
  const isAiUncertain = match.kind === 'ai-uncertain';
  const accentColor = isCritical ? 'var(--color-red)' : 'var(--color-gold)';

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
          className="text-xs uppercase tracking-wider font-semibold mb-1.5 flex items-center gap-1.5"
          style={{ color: accentColor }}
        >
          <Icon
            name={
              isCritical
                ? 'alert-octagon'
                : isAiUncertain
                ? 'search'
                : isUncertain
                ? 'pencil'
                : 'alert-triangle'
            }
          />
          {isCritical
            ? 'Критично'
            : isAiUncertain
            ? 'Маркирано за преглед'
            : isUncertain
            ? 'Несигурно разпознаване'
            : 'Извън нормата'}
        </div>
        <div
          className={
            isAiUncertain && match.suggestion
              ? 'text-sm leading-snug mb-2'
              : 'text-sm leading-snug mb-3'
          }
          style={{ color: 'var(--color-text)' }}
        >
          {match.message}
        </div>
        {isAiUncertain && match.suggestion && (
          <div
            className="text-xs leading-snug mb-3"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Предложение: <span style={{ fontWeight: 600 }}>{match.suggestion}</span>
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="flex-1 py-2 rounded text-sm font-medium text-white transition hover:opacity-90"
            style={{ background: 'var(--color-brand)' }}
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              <Icon name="pencil" /> Редактирай
            </span>
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
            <span className="inline-flex items-center justify-center gap-1.5">
              <Icon name="check" /> Потвърди
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
