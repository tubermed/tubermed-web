// Standalone assertions for the uncertain_spans display resolver
// (lib/uncertain-spans.ts). The web repo has no unit-test runner; run as tsx
// from the tubermed-web root:  npx tsx scripts/uncertain-spans.ts
//
// A2: the backend computes fields.uncertain_spans (gazetteer borderlines,
// missing/mismatched vitals, allergy-stem flags, ungrounded denials) but the
// result page never rendered them. resolveUncertainSpans is the pure core that
// turns those raw spans into render-ready, doctor-facing review markers:
//   - re-locate `original` in the CURRENT field text via indexOf (the backend
//     start/end is loose / may be stale after edits — never trusted);
//   - drop a span whose `original` is gone (doctor edited it out → self-clearing);
//   - drop acknowledged spans (key `unc::${field}::${original}` — a distinct
//     prefix so it can't collide with the vital `${field}::${raw}` keys);
//   - de-dup the main diagnosis against mkb_review so it isn't flagged twice.

import { resolveUncertainSpans, uncertainAckKey, UNCERTAIN_FIELDS } from '../lib/uncertain-spans';
import type { TranscribeFields } from '../lib/types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('  ✓ ' + msg); passed++; }
  else { console.error('  ✗ ' + msg); failed++; }
}

// ── indexOf re-location (never trust the backend start/end) ──
console.log('indexOf re-location: coords come from the CURRENT text, not the backend start/end');
{
  const fields: TranscribeFields = {
    terapia: 'Назначен ибупрофен 400 мг три пъти дневно.',
    uncertain_spans: [{
      field: 'terapia', start: 0, end: 0, original: 'ибупрофен',
      reason: 'Лекарство не разпознато сигурно — потвърди името', suggestion: 'ибупрофен',
    }],
  };
  const r = resolveUncertainSpans(fields, new Set());
  assert(r.length === 1, 'one span resolved');
  assert(r[0].field === 'terapia', 'field preserved');
  const idx = fields.terapia!.indexOf('ибупрофен');
  assert(r[0].start === idx && r[0].end === idx + 'ибупрофен'.length,
    `coords from indexOf (got ${r[0].start}-${r[0].end}, expected ${idx}-${idx + 9})`);
  assert(r[0].reason.includes('разпознато'), 'reason passthrough');
  assert(r[0].suggestion === 'ибупрофен', 'suggestion passthrough');
}

// ── stale drop (doctor edited the flagged token out) ──
console.log('stale drop: original no longer in the field text → dropped (self-clearing)');
{
  const fields: TranscribeFields = {
    terapia: 'Назначен парацетамол 500 мг.', // doctor replaced the flagged drug
    uncertain_spans: [{ field: 'terapia', start: 8, end: 17, original: 'ибупрофен', reason: 'x' }],
  };
  assert(resolveUncertainSpans(fields, new Set()).length === 0, 'stale span dropped');
}

// ── acknowledged drop (unc:: key, distinct from the vital key namespace) ──
console.log('acknowledged drop: an unc:: key in the Set → dropped');
{
  const fields: TranscribeFields = {
    obektivno: 'ДЧ: не е измерено',
    uncertain_spans: [{ field: 'obektivno', start: 0, end: 0, original: 'ДЧ: не е измерено', reason: 'ДЧ не е спомената' }],
  };
  const ack = new Set<string>([uncertainAckKey('obektivno', 'ДЧ: не е измерено')]);
  assert(resolveUncertainSpans(fields, ack).length === 0, 'acknowledged span dropped');
  assert(resolveUncertainSpans(fields, new Set()).length === 1, 'un-acknowledged span kept');
  assert(uncertainAckKey('obektivno', 'x') === 'unc::obektivno::x',
    'ack key uses the unc:: prefix (distinct from the vital `${field}::${raw}` keys)');
}

// ── osnovna_diagnoza ↔ mkb_review de-dup (don't flag the diagnosis twice) ──
console.log('de-dup: osnovna_diagnoza span suppressed when mkb_review already surfaces the diagnosis');
{
  const span = { field: 'osnovna_diagnoza', start: 0, end: 0, original: 'Тиреоидит', reason: 'не личи в разговора' };
  const base: TranscribeFields = { osnovna_diagnoza: 'Тиреоидит', uncertain_spans: [span] };
  const surfaced = resolveUncertainSpans(
    { ...base, mkb_review: { needs_review: true, reason: 'diagnosis_text_not_grounded', code: 'E00.2' } },
    new Set(),
  );
  assert(surfaced.filter((s) => s.field === 'osnovna_diagnoza').length === 0,
    'osnovna_diagnoza span de-duped when the grounding banner surfaces it');
  const notSurfaced = resolveUncertainSpans(base, new Set());
  assert(notSurfaced.filter((s) => s.field === 'osnovna_diagnoza').length === 1,
    'osnovna_diagnoza span kept when nothing else surfaces it (de-dup is conditional, not a blanket exclusion)');
  const otherReason = resolveUncertainSpans(
    { ...base, mkb_review: { needs_review: true, reason: 'invalid_code', code: 'ZZZ' } },
    new Set(),
  );
  assert(otherReason.filter((s) => s.field === 'osnovna_diagnoza').length === 1,
    'de-dup is specific to diagnosis_text_not_grounded');
}

// ── grouping + per-field ordering by start ──
console.log('grouping: spans across fields, each field ordered by resolved start');
{
  const fields: TranscribeFields = {
    anamneza: 'Отрича тютюнопушене. Пациентът съобщава болка.',
    terapia: 'метформин 500 и бисопролол 5',
    uncertain_spans: [
      { field: 'terapia', start: 0, end: 0, original: 'бисопролол', reason: 'b' },
      { field: 'terapia', start: 0, end: 0, original: 'метформин', reason: 'a' },
      { field: 'anamneza', start: 0, end: 0, original: 'Отрича тютюнопушене', reason: 'denial' },
    ],
  };
  const r = resolveUncertainSpans(fields, new Set());
  const terapiaSpans = r.filter((s) => s.field === 'terapia');
  assert(terapiaSpans.length === 2, 'two terapia spans');
  assert(terapiaSpans[0].original === 'метформин' && terapiaSpans[1].original === 'бисопролол',
    'terapia spans ordered by start (метформин before бисопролол)');
  assert(r.some((s) => s.field === 'anamneza'), 'anamneza denial span present');
  assert(UNCERTAIN_FIELDS.includes('napravlenia') && UNCERTAIN_FIELDS.includes('naznacheni'),
    'UNCERTAIN_FIELDS covers napravlenia + naznacheni (the superset beyond the vital-scanned fields)');
}

// ── empty / missing inputs ──
console.log('empty: no/empty uncertain_spans, or a field with no text → []');
{
  assert(resolveUncertainSpans({}, new Set()).length === 0, 'no uncertain_spans → []');
  assert(resolveUncertainSpans({ uncertain_spans: [] }, new Set()).length === 0, 'empty array → []');
  assert(
    resolveUncertainSpans({ uncertain_spans: [{ field: 'terapia', start: 0, end: 0, original: 'x' }] }, new Set()).length === 0,
    'span for an empty/absent field → dropped (nothing to locate against)',
  );
}

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
