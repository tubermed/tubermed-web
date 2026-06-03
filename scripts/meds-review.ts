// Standalone parity test for the client-side medication-completeness logic in
// lib/meds-review.ts — must agree with the backend gate (tubermed-backend
// lib/process-audio.js → validateMedicationCompleteness) so a med the client
// considers complete is never 409-rejected at /approve, and vice-versa.
//
// The web repo has no unit-test runner; logic regressions run as standalone tsx.
// Run from the tubermed-web root: npx tsx scripts/meds-review.ts
//   exit 0 on pass, 1 on fail. Pure — no network, no API.

import {
  computeMedsReview,
  medComponentFilled,
  medsBlockMessage,
  MED_REQUIRED_COMPONENTS,
} from '../lib/meds-review';
import type { Medication } from '../lib/types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('  ✓ ' + msg); passed++; }
  else { console.error('  ✗ ' + msg); failed++; }
}

function fullMed(over: Partial<Medication> = {}): Medication {
  return {
    inn: 'амлодипин', form: 'таблетка', dose: '5 mg', regimen: '1×1',
    route: 'р.о.', duration: 'дългосрочно', ...over,
  };
}

// ── required set: five components incl. form, excl. route ──
console.log('\nrequired components');
{
  const set = new Set<string>(MED_REQUIRED_COMPONENTS);
  assert(MED_REQUIRED_COMPONENTS.length === 5, 'exactly five required');
  assert(set.has('inn') && set.has('form') && set.has('dose') && set.has('regimen') && set.has('duration'),
    'name/form/dose/frequency/duration all required');
  assert(!set.has('route'), 'route is NOT required');
  // Parity with the backend MED_REQUIRED_COMPONENTS order.
  assert(MED_REQUIRED_COMPONENTS.join(',') === 'inn,form,dose,regimen,duration', 'order matches the backend');
}

// ── medComponentFilled ──
console.log('\nmedComponentFilled');
{
  assert(medComponentFilled('5 mg') === true, 'non-empty string is filled');
  assert(medComponentFilled('') === false, 'empty string is missing');
  assert(medComponentFilled('   ') === false, 'whitespace-only is missing');
  assert(medComponentFilled(undefined) === false, 'undefined is missing');
}

// ── complete med → not blocked ──
console.log('\ncompleteness');
{
  const r = computeMedsReview([fullMed()], null);
  assert(r.needs_review === false, 'fully-specified med not blocked');
  assert(r.meds[0].missing.length === 0, 'no missing');
}

// ── missing duration → marked, blocked ──
{
  const r = computeMedsReview([fullMed({ duration: '' })], null);
  assert(r.meds[0].missing.includes('duration'), 'missing duration marked');
  assert(r.needs_review === true, 'blocked while unresolved');
}

// ── missing form (the new component) → marked, blocked ──
{
  const r = computeMedsReview([fullMed({ form: '' })], null);
  assert(r.meds[0].missing.includes('form'), 'missing form marked');
  assert(r.needs_review === true, 'missing form blocks');
}

// ── fill clears ──
console.log('\nfill / dismiss');
{
  let r = computeMedsReview([fullMed({ duration: '' })], null);
  assert(r.needs_review === true, 'starts blocked');
  r = computeMedsReview([fullMed({ duration: '7 дни' })], r);
  assert(r.needs_review === false, 'fill clears');
}

// ── dismiss clears WITHOUT writing a value ──
{
  const meds = [fullMed({ duration: '' })];
  let r = computeMedsReview(meds, null);
  // doctor dismisses duration on med 0
  r = computeMedsReview(meds, { needs_review: r.needs_review, meds: [{ missing: r.meds[0].missing, dismissed: ['duration'] }] });
  assert(r.meds[0].dismissed.includes('duration'), 'dismissal preserved');
  assert(r.meds[0].missing.includes('duration'), 'still empty (recorded missing)');
  assert(r.needs_review === false, 'dismiss clears the block');
  assert(meds[0].duration === '', 'dismiss never writes a value into the med');
}

// ── re-empty a previously-filled component re-blocks ──
{
  let r = computeMedsReview([fullMed({ duration: '5 дни' })], null);
  assert(r.needs_review === false, 'filled → clear');
  r = computeMedsReview([fullMed({ duration: '' })], r);
  assert(r.needs_review === true, 'clearing re-blocks');
}

// ── index-aligned dismissals don't leak across meds ──
{
  const meds = [fullMed({ dose: '' }), fullMed({ duration: '' })];
  let r = computeMedsReview(meds, null);
  r = computeMedsReview(meds, {
    needs_review: r.needs_review,
    meds: [r.meds[0], { missing: r.meds[1].missing, dismissed: ['duration'] }],
  });
  assert(r.needs_review === true, 'med 0 (dose) still unresolved → blocked');
  assert(r.meds[1].dismissed.includes('duration'), 'med 1 dismissal preserved at its index');
  assert(!r.meds[0].dismissed.includes('duration'), 'dismissal did NOT leak onto med 0');
}

// ── stale dismissal dropped once the component is filled ──
{
  const meds = [fullMed({ duration: '' })];
  let r = computeMedsReview(meds, { needs_review: true, meds: [{ missing: ['duration'], dismissed: ['duration'] }] });
  assert(r.meds[0].dismissed.includes('duration'), 'dismissed while empty');
  const filled = [fullMed({ duration: '3 дни' })];
  r = computeMedsReview(filled, r);
  assert(r.meds[0].missing.length === 0 && r.meds[0].dismissed.length === 0, 'fill drops the stale dismissal');
}

// ── no meds → not blocked ──
{
  const r = computeMedsReview([], null);
  assert(r.needs_review === false, 'empty list passes');
  assert(r.meds.length === 0, 'meds review is empty');
}

// ── medsBlockMessage ──
console.log('\nblock message');
{
  const msg = medsBlockMessage();
  assert(typeof msg === 'string' && msg.length > 0, 'returns a localized message');
}

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
