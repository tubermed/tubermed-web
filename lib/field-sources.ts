// Stored-offset source lookup (trust layer Batch B).
//
// Maps a result-page fieldKey to its backend-resolved field_sources entries
// and merges them into ONE SourceSpan for TranscriptBody (which already
// union-renders multi-range tokens). Offsets come from the backend's RAW
// transcript; the in-session transcript is that same payload, but every entry
// is still bounds-validated against it — an out-of-bounds entry (divergent or
// corrupt row) is treated as unresolved, never sliced blindly. Pure module:
// no React, no network — offline-testable via scripts/field-sources-cases.ts.

import type { FieldSource } from './types';
import type { SourceSpan } from './source-grounding';

// fieldKey → field_sources keys. anamneza is deliberately ABSENT: narrative
// fields are never quoted (a single quote for a whole-conversation synthesis
// would be a confident-looking lie — the honest-null ruling). obektivno maps
// to the dictated-vitals span AND the per-finding exam spans (G7:
// obektivno_findings.<i>, index-aligned to the exam-finding clauses), merged
// into one multi-token span; its free-flowing prose is otherwise unquoted. An
// ungrounded finding emits no offset, so it contributes no token — and an
// obektivno with no grounded vitals or findings stays honestly „няма ясен
// източник". terapia maps to the per-medication spans (index-aligned to
// medications_list).
const FIELD_SOURCE_LOOKUP: Record<string, { exact?: string[]; prefix?: string }> = {
  obektivno:        { exact: ['vitals'], prefix: 'obektivno_findings.' },
  osnovna_diagnoza: { exact: ['osnovna_diagnoza'] },
  napravlenia:      { exact: ['napravlenia'] },
  terapia:          { prefix: 'medications_list.' },
  izsledvania:      { prefix: 'izsledvania.' },
  naznacheni:       { prefix: 'naznacheni.' },
};

// `method` is informational (resolver identifier), never a gate — a future
// resolver version must not silently disable existing highlights.
export function isValidFieldSource(s: unknown, transcriptLength: number): s is FieldSource {
  if (!s || typeof s !== 'object') return false;
  const { start, end } = s as { start: unknown; end: unknown };
  return (
    typeof start === 'number' && Number.isInteger(start) &&
    typeof end === 'number' && Number.isInteger(end) &&
    start >= 0 && end > start && end <= transcriptLength
  );
}

// Collect the field's valid entries and merge them into one SourceSpan:
// tokens = the individual ranges (ascending), span.start/end = their hull.
// No valid entries (legacy row, unmapped field, all out-of-bounds) → null.
export function storedSpanFor(
  fieldKey: string,
  sources: Record<string, FieldSource> | undefined,
  transcriptLength: number,
): SourceSpan | null {
  if (!sources || transcriptLength <= 0) return null;
  const lookup = FIELD_SOURCE_LOOKUP[fieldKey];
  if (!lookup) return null;

  const entries: FieldSource[] = [];
  for (const key of lookup.exact ?? []) {
    const e = sources[key];
    if (isValidFieldSource(e, transcriptLength)) entries.push(e);
  }
  if (lookup.prefix) {
    for (const [key, e] of Object.entries(sources)) {
      if (key.startsWith(lookup.prefix) && isValidFieldSource(e, transcriptLength)) entries.push(e);
    }
  }
  if (entries.length === 0) return null;

  const tokens = entries
    .map((e) => ({ start: e.start, end: e.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  return {
    start: tokens[0].start,
    end: tokens.reduce((max, t) => Math.max(max, t.end), 0),
    tokens,
  };
}
