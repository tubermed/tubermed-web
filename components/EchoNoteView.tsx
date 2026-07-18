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
  isLocked: boolean;
  // Persisted via the result page's edit-flush (same /edit endpoint as the
  // консултация note). `path` is the template field path (∈ ECHO_EDIT_FIELDS).
  onEditText: (path: string, value: string) => void;
  onEditMeasurement: (path: string, next: EchoMeasurement) => void;
}

function readMeasurement(fields: EchoFields, path: string): EchoMeasurement {
  const v = readEchoPath(fields, path);
  if (v && typeof v === 'object') {
    const m = v as Partial<EchoMeasurement>;
    return { value: typeof m.value === 'string' ? m.value : '', unit: typeof m.unit === 'string' ? m.unit : '' };
  }
  return { value: '', unit: '' };
}

function readText(fields: EchoFields, path: string): string {
  const v = readEchoPath(fields, path);
  return typeof v === 'string' ? v : '';
}

// The uncertain-span field key the backend attaches: measurements flag on
// `${path}.value`; free text flags on the field path itself.
function spanKeyFor(f: EchoFieldDescriptor): string {
  return f.kind === 'measurement' ? `${f.path}.value` : f.path;
}

export default function EchoNoteView({ fields, isLocked, onEditText, onEditMeasurement }: EchoNoteViewProps) {
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
                    isLocked={isLocked}
                    flags={flags}
                    onChange={(next) => onEditMeasurement(f.path, next)}
                  />
                ) : (
                  <TextRow
                    key={f.path}
                    descriptor={f}
                    value={readText(fields, f.path)}
                    isLocked={isLocked}
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

function MeasurementRow({
  descriptor, value, isLocked, flags, onChange,
}: {
  descriptor: EchoFieldDescriptor;
  value: EchoMeasurement;
  isLocked: boolean;
  flags: UncertainSpan[];
  onChange: (next: EchoMeasurement) => void;
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
        <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {value.unit || descriptor.unit || ''}
        </span>
      </span>
      <div className="w-full"><FlagNotes flags={flags} /></div>
    </div>
  );
}

function TextRow({
  descriptor, value, isLocked, flags, onChange,
}: {
  descriptor: EchoFieldDescriptor;
  value: string;
  isLocked: boolean;
  flags: UncertainSpan[];
  onChange: (v: string) => void;
}) {
  const flagged = flags.length > 0;
  return (
    <div>
      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
        {descriptor.label}
      </label>
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
      <FlagNotes flags={flags} />
    </div>
  );
}
