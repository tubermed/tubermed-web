'use client';

// ─────────────────────────────────────────────────────────────────────────────
// InvestigationBlockCard — one embedded investigation block rendered as a
// titled card inside the Изследвания section of the консултация лист
// ─────────────────────────────────────────────────────────────────────────────
// Tolerant reader by contract (lib/investigation-blocks.ts): a malformed block
// or an unregistered `type` renders NOTHING — never crash the лист, never
// affect the sibling flat fields. Block-local uncertain_spans (their `field`
// keys are dot-paths RELATIVE to block.fields) render as amber notes on the
// matching row, exactly like the standalone echo document.
//
// Approval-gate note: on the result page `isLocked` gates ONLY copy/export
// affordances, NEVER editing (docs/history/2026-06.md: "Pre-approval editing
// is ALWAYS enabled … do NOT re-gate editing on isLocked" — re-gating caused
// the reconcile deadlock). This card adds no egress affordance of its own; its
// export path is the page's gated exporters. Rows are editable whenever both
// edit callbacks are supplied (the result page wires them through the shared
// debounced /edit flush); a caller that omits them gets a read-only card.
//
// Card chrome stays flat (hairline border, no elevation) — the note sheet is
// "one calm sheet"; elevation is reserved for the safety rail.

import { useMemo } from 'react';
import {
  MeasurementRow,
  TextRow,
  readMeasurement,
  readText,
  spanKeyFor,
} from '@/components/EchoNoteView';
import { getInvestigationBlockDescriptor } from '@/lib/investigation-blocks';
import type { EchoMeasurement, InvestigationBlock, UncertainSpan } from '@/lib/types';

interface InvestigationBlockCardProps {
  block: InvestigationBlock;
  // Wired in C6 (dot-path edit variant). `path` is RELATIVE to block.fields —
  // the caller prefixes `izsledvania_blocks.${i}.fields.` for /edit.
  onEditText?: (path: string, value: string) => void;
  onEditMeasurement?: (path: string, next: EchoMeasurement) => void;
}

export default function InvestigationBlockCard({
  block,
  onEditText,
  onEditMeasurement,
}: InvestigationBlockCardProps) {
  const editable = !!(onEditText && onEditMeasurement);
  const fields =
    block && typeof block === 'object' && block.fields && typeof block.fields === 'object'
      ? block.fields
      : undefined;

  // Group block-local flags by the (block-relative) field key they target.
  const flagsByField = useMemo(() => {
    const map: Record<string, UncertainSpan[]> = {};
    for (const s of fields?.uncertain_spans || []) {
      if (!s || typeof s.field !== 'string') continue;
      (map[s.field] ||= []).push(s);
    }
    return map;
  }, [fields]);

  const descriptor =
    block && typeof block.type === 'string' ? getInvestigationBlockDescriptor(block.type) : undefined;
  if (!descriptor || !fields) return null;

  return (
    <section
      className="rounded-lg border p-4 sm:p-5"
      style={{ borderColor: 'var(--color-border-mid)', background: 'var(--color-bg)' }}
    >
      <div
        className="text-sm font-semibold mb-4 flex items-center gap-1.5"
        style={{ color: 'var(--color-ink)' }}
      >
        <span aria-hidden>◇</span> {descriptor.title}
      </div>
      <div className="space-y-5">
        {descriptor.sections.map((section) => {
          // Same sparse-readout rule as the standalone echo document: a section
          // renders only when at least one field is populated or flagged —
          // except Заключение, which always shows.
          const anyContent = section.fields.some((f) => {
            if (flagsByField[spanKeyFor(f)]?.length) return true;
            return f.kind === 'measurement'
              ? readMeasurement(fields, f.path).value.trim() !== ''
              : readText(fields, f.path).trim() !== '';
          });
          if (!anyContent && section.key !== 'zakljuchenie') return null;

          return (
            <div key={section.key}>
              <div
                className="text-xs uppercase tracking-wider font-medium mb-2"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {section.title}
              </div>
              <div className="space-y-3">
                {section.fields.map((f) => {
                  const flags = flagsByField[spanKeyFor(f)] || [];
                  return f.kind === 'measurement' ? (
                    <MeasurementRow
                      key={f.path}
                      descriptor={f}
                      value={readMeasurement(fields, f.path)}
                      isLocked={!editable}
                      flags={flags}
                      onChange={(next) => onEditMeasurement?.(f.path, next)}
                    />
                  ) : (
                    <TextRow
                      key={f.path}
                      descriptor={f}
                      value={readText(fields, f.path)}
                      isLocked={!editable}
                      flags={flags}
                      onChange={(v) => onEditText?.(f.path, v)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
