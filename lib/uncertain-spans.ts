// A2 — surface the AI's uncertainty (render fields.uncertain_spans).
//
// The backend computes fields.uncertain_spans (gazetteer drug-name borderlines,
// missing/mismatched vitals, allergy-stem flags, ungrounded denials) but the
// result page never rendered them — a documented gap. resolveUncertainSpans is
// the pure, testable core that turns those raw spans into render-ready,
// doctor-facing review markers. It is ADVISORY: spans are surfaced, counted, and
// acknowledgeable, but they do NOT add a new approval-blocking gate (the backend
// already hard-blocks the main diagnosis via mkb_review).
//
// Pure — no React, no DOM. Asserted by scripts/uncertain-spans.ts.

import type { TranscribeFields } from './types';

export interface ResolvedUncertainSpan {
  field: string;
  original: string;
  reason: string;
  suggestion: string;
  start: number; // re-located against the CURRENT field text
  end: number;
}

// Note fields that have an inline render surface (EditableField) on the result
// page — the set the result-page pipeline iterates. This is a SUPERSET of the
// four fields the vital-range counter scans (it adds napravlenia + naznacheni).
// osnovna_diagnoza is intentionally absent: it renders via DiagnosesSection and
// its ungrounding is surfaced by the mkb_review banner (see the de-dup below);
// meds / comorbidities have no span surface yet (backend defers them).
export const UNCERTAIN_FIELDS: readonly string[] = [
  'anamneza',
  'obektivno',
  'izsledvania',
  'terapia',
  'napravlenia',
  'naznacheni',
];

// Acknowledge-key namespace for an uncertain span. The distinct `unc::` prefix
// guarantees it can NEVER collide with the vital acknowledge keys, which are
// `${fieldKey}::${raw}`.
export function uncertainAckKey(field: string, original: string): string {
  return `unc::${field}::${original}`;
}

export function resolveUncertainSpans(
  fields: TranscribeFields,
  acknowledged: Set<string>,
): ResolvedUncertainSpan[] {
  const spans = fields.uncertain_spans;
  if (!Array.isArray(spans) || spans.length === 0) return [];

  const review = fields.mkb_review;
  const diagnosisGroundingSurfaced =
    !!review?.needs_review && review.reason === 'diagnosis_text_not_grounded';

  const record = fields as unknown as Record<string, unknown>;

  // Stable grouping: keep the order fields first appear in the input, then sort
  // each field's spans by resolved start so render order === counter order.
  const fieldOrder: string[] = [];
  const byField = new Map<string, ResolvedUncertainSpan[]>();

  for (const span of spans) {
    if (!span || typeof span.field !== 'string' || typeof span.original !== 'string') continue;
    const { field, original } = span;
    if (original.length === 0) continue;

    // De-dup: the main diagnosis is already surfaced by the mkb_review banner
    // (diagnosis_text_not_grounded). Don't flag the same diagnosis twice.
    if (field === 'osnovna_diagnoza' && diagnosisGroundingSurfaced) continue;

    // Acknowledged → drop (self-clearing).
    if (acknowledged.has(uncertainAckKey(field, original))) continue;

    // Re-locate against the CURRENT text — the backend start/end is loose and
    // may be stale after edits, so it is never trusted (same spirit as the
    // backend's own indexOf position-fallback).
    const text = record[field];
    if (typeof text !== 'string') continue;
    const start = text.indexOf(original);
    if (start < 0) continue; // gone — doctor edited it out

    if (!byField.has(field)) {
      byField.set(field, []);
      fieldOrder.push(field);
    }
    byField.get(field)!.push({
      field,
      original,
      reason: span.reason ?? '',
      suggestion: span.suggestion ?? '',
      start,
      end: start + original.length,
    });
  }

  const out: ResolvedUncertainSpan[] = [];
  for (const field of fieldOrder) {
    const arr = byField.get(field)!;
    arr.sort((a, b) => a.start - b.start);
    out.push(...arr);
  }
  return out;
}
