// Trust layer Batch B — lib/field-sources.ts stored-offset lookup.
//
// Contract under test: fieldKey→field_sources mapping (scalars direct,
// per-item prefixes collected and merged into one multi-token SourceSpan),
// bounds validation against the in-session transcript (invalid entries are
// individually excluded, never sliced blindly), anamneza always null
// (narrative honest-null ruling), legacy rows (absent key) null, and `method`
// informational-only.
//
// Run: npx tsx scripts/field-sources-cases.ts   (exit 0 on pass, 1 on fail)

import { storedSpanFor, isValidFieldSource } from '../lib/field-sources';
import type { FieldSource } from '../lib/types';

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✓ ${message}`); passed++; }
  else { console.error(`  ✗ ${message}`); failed++; }
}

const LEN = 500; // synthetic in-session transcript length
const src = (start: number, end: number, method = 'quote-v1'): FieldSource => ({ method, start, end });

// ── 1. Scalar mapping: obektivno → vitals ────────────────────────────────────
{
  const span = storedSpanFor('obektivno', { vitals: src(40, 96) }, LEN);
  assert(!!span, 'obektivno resolves via the vitals entry');
  assert(!!span && span.start === 40 && span.end === 96, 'scalar span carries the stored offsets');
  assert(!!span && span.tokens.length === 1, 'scalar span has a single token range');
}

// ── 1b. G7 merge: obektivno ← vitals + obektivno_findings.* ──────────────────
// G7 added per-finding exam grounding; obektivno now merges the dictated-vitals
// span with each grounded finding clause into one multi-token span.
{
  const span = storedSpanFor('obektivno', {
    vitals: src(40, 96),
    'obektivno_findings.0': src(120, 150),
    'obektivno_findings.1': src(200, 232),
    'medications_list.0': src(300, 340), // unrelated field entry must not leak in
  }, LEN);
  assert(!!span && span.tokens.length === 3, 'obektivno merges vitals + two finding spans into 3 tokens');
  assert(!!span && span.start === 40 && span.end === 232, 'obektivno span is the hull of vitals + finding tokens');
  assert(!!span && span.tokens[0].start === 40 && span.tokens[1].start === 120 && span.tokens[2].start === 200,
    'obektivno tokens sorted ascending regardless of key order');

  // A grounded finding alone (no vitals) still resolves — the affordance lights it.
  const findingOnly = storedSpanFor('obektivno', { 'obektivno_findings.2': src(120, 150) }, LEN);
  assert(!!findingOnly && findingOnly.tokens.length === 1 && findingOnly.start === 120,
    'a grounded finding alone resolves obektivno without a vitals span');

  // An out-of-bounds finding is excluded; if it is the only entry, obektivno is
  // honestly „няма ясен източник" (the G7 ungrounded-finding case).
  assert(storedSpanFor('obektivno', { 'obektivno_findings.0': src(LEN + 5, LEN + 40) }, LEN) === null,
    'obektivno whose only finding is out-of-bounds → null (няма ясен източник)');
}

// ── 2. Multi-item merge: terapia ← medications_list.* ────────────────────────
{
  const span = storedSpanFor('terapia', {
    'medications_list.1': src(300, 340),
    'medications_list.0': src(120, 168),
    'medications_list.2': src(410, 460),
    vitals: src(40, 96), // unrelated entry must not leak in
  }, LEN);
  assert(!!span && span.tokens.length === 3, 'three medication entries merge into one span with 3 tokens');
  assert(!!span && span.start === 120 && span.end === 460, 'span start/end are the hull of all tokens');
  assert(!!span && span.tokens[0].start === 120 && span.tokens[1].start === 300 && span.tokens[2].start === 410,
    'tokens are sorted ascending regardless of key order');
}

// ── 3. Bounds validation: each violation class individually excluded ─────────
{
  assert(storedSpanFor('obektivno', { vitals: src(40, LEN + 1) }, LEN) === null, 'end beyond transcript → excluded');
  assert(storedSpanFor('obektivno', { vitals: src(-1, 20) }, LEN) === null, 'negative start → excluded');
  assert(storedSpanFor('obektivno', { vitals: src(96, 40) }, LEN) === null, 'start >= end → excluded');
  assert(storedSpanFor('obektivno', { vitals: src(1.5, 20) }, LEN) === null, 'non-integer offsets → excluded');
  assert(storedSpanFor('obektivno', { vitals: 'garbage' as unknown as FieldSource }, LEN) === null,
    'non-object entry → excluded');
  assert(storedSpanFor('obektivno', { vitals: src(40, 96) }, 0) === null, 'empty transcript (cold-start) → null');
}

// ── 4. Mixed valid/invalid: only valid tokens survive ────────────────────────
{
  const span = storedSpanFor('izsledvania', {
    'izsledvania.0': src(100, 140),
    'izsledvania.1': src(480, 600), // out of bounds → dropped
    'izsledvania.2': src(200, 240),
  }, LEN);
  assert(!!span && span.tokens.length === 2 && span.end === 240, 'invalid entry dropped, valid ones still merge');
}

// ── 5. Honest nulls ──────────────────────────────────────────────────────────
{
  assert(storedSpanFor('anamneza', { vitals: src(40, 96) }, LEN) === null,
    'anamneza is always null (narrative fields are deliberately unsourced)');
  assert(storedSpanFor('obektivno', undefined, LEN) === null, 'absent field_sources (legacy row) → null');
  assert(storedSpanFor('obektivno', {}, LEN) === null, 'empty field_sources → null');
  assert(storedSpanFor('napravlenia', { 'naznacheni.0': src(10, 40) }, LEN) === null,
    'no matching key for the field → null');
}

// ── 6. method is informational, not a gate ───────────────────────────────────
{
  const span = storedSpanFor('osnovna_diagnoza', { osnovna_diagnoza: src(60, 110, 'quote-v9-future') }, LEN);
  assert(!!span, 'unknown method string is accepted (future resolver versions keep highlighting)');
  assert(isValidFieldSource(src(0, 1), 1), 'isValidFieldSource accepts a minimal in-bounds entry');
}

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
