'use client';

// ─────────────────────────────────────────────────────────────────────────────
// EchoNoteView — type-branched rendering of the echo readout (note_type='echo')
// ─────────────────────────────────────────────────────────────────────────────
// Renders the echo-v1 template sections (incl. aorta) as an editable structured
// document: measurements as value+unit, free-text sections as textareas, and the
// AI-uncertainty flags (fields.uncertain_spans) as amber notes on the matching
// field. There is NO diagnosis/МКБ UI on this path by construction — the echo
// document has no such shape. Approval, disclaimer and export chrome are owned by
// the result page (this component is only the document body).

import { useMemo } from 'react';
import { NoteSectionHead } from '@/components/ui/NoteSection';
import { ECHO_SECTIONS, readEchoPath, type EchoFieldDescriptor } from '@/lib/echo-template';
import type { EchoFields, EchoMeasurement, UncertainSpan } from '@/lib/types';

interface EchoNoteViewProps {
  fields: EchoFields;
  // Persisted via the result page's edit-flush (same /edit endpoint as the
  // консултация note). `path` is the template field path (∈ ECHO_EDIT_FIELDS).
  onEditText: (path: string, value: string) => void;
  onEditMeasurement: (path: string, next: EchoMeasurement) => void;
  /** SEALED readout (backend migration 024): the visit is over and the лист is
   *  closed for editing, permanently. Every row renders its value as text
   *  instead of an input — see MeasurementRow/TextRow for why this is a third
   *  state and not just a stronger `isLocked`. */
  sealed?: boolean;
}
// NOTE deliberately NO isLocked prop: pre-approval editing is ALWAYS enabled —
// isLocked gates ONLY copy/export/approve, never editing (docs/history/
// 2026-06.md, the reconcile-deadlock lesson). Wiring it into the inputs made
// the echo document read-only before Потвърждавам and re-locked it after one
// keystroke post-approval (trackEdit flips reviewStatus back to 'pending').

export function readMeasurement(fields: EchoFields, path: string): EchoMeasurement {
  const v = readEchoPath(fields, path);
  if (v && typeof v === 'object') {
    const m = v as Partial<EchoMeasurement>;
    return { value: typeof m.value === 'string' ? m.value : '', unit: typeof m.unit === 'string' ? m.unit : '' };
  }
  return { value: '', unit: '' };
}

export function readText(fields: EchoFields, path: string): string {
  const v = readEchoPath(fields, path);
  return typeof v === 'string' ? v : '';
}

// The uncertain-span field key the backend attaches: measurements flag on
// `${path}.value`; free text flags on the field path itself.
export function spanKeyFor(f: EchoFieldDescriptor): string {
  return f.kind === 'measurement' ? `${f.path}.value` : f.path;
}

export default function EchoNoteView({ fields, onEditText, onEditMeasurement, sealed = false }: EchoNoteViewProps) {
  // Group flags by the field key they target, so each field can show its own.
  const flagsByField = useMemo(() => {
    const map: Record<string, UncertainSpan[]> = {};
    for (const s of fields.uncertain_spans || []) {
      if (!s || typeof s.field !== 'string') continue;
      (map[s.field] ||= []).push(s);
    }
    return map;
  }, [fields.uncertain_spans]);

  return (
    <div className="space-y-8">
      {ECHO_SECTIONS.map((section) => {
        // Skip a section only when EVERY field is empty AND it carries no flag —
        // keeps a sparse readout (e.g. a device interrogation with just a
        // Заключение) from rendering a wall of empty inputs, while never hiding a
        // populated or flagged field. Заключение always shows.
        const anyContent = section.fields.some((f) => {
          if (flagsByField[spanKeyFor(f)]?.length) return true;
          return f.kind === 'measurement'
            ? readMeasurement(fields, f.path).value.trim() !== ''
            : readText(fields, f.path).trim() !== '';
        });
        if (!anyContent && section.key !== 'zakljuchenie') return null;

        return (
          <section key={section.key} id={`echo-sec-${section.key}`}>
            <NoteSectionHead title={section.title} icon={<span aria-hidden>◇</span>} />
            <div className="mt-3 space-y-3">
              {section.fields.map((f) => {
                const flags = flagsByField[spanKeyFor(f)] || [];
                return f.kind === 'measurement' ? (
                  <MeasurementRow
                    key={f.path}
                    descriptor={f}
                    value={readMeasurement(fields, f.path)}
                    isLocked={false}
                    sealed={sealed}
                    flags={flags}
                    onChange={(next) => onEditMeasurement(f.path, next)}
                  />
                ) : (
                  <TextRow
                    key={f.path}
                    descriptor={f}
                    value={readText(fields, f.path)}
                    isLocked={false}
                    sealed={sealed}
                    flags={flags}
                    onChange={(v) => onEditText(f.path, v)}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FlagNotes({ flags }: { flags: UncertainSpan[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-1">
      {flags.map((s, i) => (
        <div
          key={i}
          className="text-xs px-2 py-1 rounded inline-flex items-start gap-1.5"
          style={{ color: 'var(--color-gold)', background: 'var(--color-gold-soft, rgba(180,140,0,0.08))' }}
        >
          <span aria-hidden>⚠</span>
          <span>{s.reason || 'Възможна транскрипционна грешка — прегледайте оригинала.'}</span>
        </div>
      ))}
    </div>
  );
}

// MeasurementRow/TextRow are exported for reuse by InvestigationBlockCard
// (embedded izsledvania_blocks on the консултация note) — same rendering for a
// measurement/text field whichever container it lives in. `isLocked` disables
// the input (read-only rendering); the styling and flag notes are identical.
//
// `sealed` is a THIRD state, not a stronger `isLocked`. A disabled input still
// reads as a form whose fields mysteriously don't respond; a sealed лист must
// read as a document. So sealed renders the VALUE as text — no border, no
// field background, no focus ring, no caret — while keeping the label, the
// units, the reference range, the flag colour and the spacing byte-identical,
// so the doctor recognises the same лист he just approved.
export function MeasurementRow({
  descriptor, value, isLocked, flags, onChange, sealed = false,
}: {
  descriptor: EchoFieldDescriptor;
  value: EchoMeasurement;
  isLocked: boolean;
  flags: UncertainSpan[];
  onChange: (next: EchoMeasurement) => void;
  sealed?: boolean;
}) {
  const flagged = flags.length > 0;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <label className="text-sm font-medium min-w-[240px]" style={{ color: 'var(--color-text)' }}>
        {descriptor.label}
        {descriptor.refNorma && (
          <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--color-text-muted)' }}>
            (реф. {descriptor.refNorma})
          </span>
        )}
      </label>
      <span className="inline-flex items-baseline gap-1.5">
        {sealed ? (
          // Same 6rem column so a sealed readout keeps the approved layout's
          // right-aligned value column instead of reflowing.
          <span
            className="w-24 px-2 py-1 text-sm text-right inline-block"
            style={{ color: flagged ? 'var(--color-gold)' : 'var(--color-text)' }}
          >
            {value.value.trim() || '—'}
          </span>
        ) : (
          <input
            type="text"
            inputMode="decimal"
            value={value.value}
            disabled={isLocked}
            placeholder="—"
            onChange={(e) => onChange({ value: e.target.value, unit: value.unit })}
            className="w-24 px-2 py-1 rounded text-sm text-right focus-ring disabled:opacity-60"
            style={{
              border: `1px solid ${flagged ? 'var(--color-gold)' : 'var(--color-border-mid)'}`,
              background: isLocked ? 'var(--color-bg)' : 'white',
              color: 'var(--color-text)',
            }}
          />
        )}
        <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {value.unit || descriptor.unit || ''}
        </span>
      </span>
      {/* Flags stay: they are advisory prose, already non-interactive, and
          reading what the AI doubted is part of reading the note honestly. */}
      <div className="w-full"><FlagNotes flags={flags} /></div>
    </div>
  );
}

export function TextRow({
  descriptor, value, isLocked, flags, onChange, sealed = false,
}: {
  descriptor: EchoFieldDescriptor;
  value: string;
  isLocked: boolean;
  flags: UncertainSpan[];
  onChange: (v: string) => void;
  sealed?: boolean;
}) {
  const flagged = flags.length > 0;
  const hasContent = value.trim().length > 0;
  return (
    <div>
      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
        {descriptor.label}
      </label>
      {sealed ? (
        // Same padding + text size as the textarea it replaces, so the sealed
        // лист keeps the approved layout; whitespace-pre-wrap preserves the
        // dictated line breaks a textarea would have shown.
        <div
          className="w-full px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed"
          style={{ color: hasContent ? 'var(--color-text)' : 'var(--color-text-muted)' }}
        >
          {hasContent ? value : 'Не е споменато'}
        </div>
      ) : (
        <textarea
          value={value}
          disabled={isLocked}
          placeholder="Не е споменато"
          rows={descriptor.path === 'zakljuchenie' ? 3 : 2}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 rounded text-sm resize-y focus-ring disabled:opacity-60"
          style={{
            border: `1px solid ${flagged ? 'var(--color-gold)' : 'var(--color-border-mid)'}`,
            background: isLocked ? 'var(--color-bg)' : 'white',
            color: 'var(--color-text)',
          }}
        />
      )}
      <FlagNotes flags={flags} />
    </div>
  );
}
