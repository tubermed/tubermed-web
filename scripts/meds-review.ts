// Standalone parity test for the client-side medication-completeness logic in
// lib/meds-review.ts — must agree with the backend gate (tubermed-backend
// lib/process-audio.js → validateMedicationCompleteness) so a med the client
// considers complete is never 409-rejected at /approve, and vice-versa.
//
// Fill-required: there is NO dismiss escape — a missing component clears only by
// being FILLED (free text accepted).
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

// ── complete med → not blocked, no dismissed field ──
console.log('\ncompleteness');
{
  const r = computeMedsReview([fullMed()]);
  assert(r.needs_review === false, 'fully-specified med not blocked');
  assert(r.meds[0].missing.length === 0, 'no missing');
  assert(!('dismissed' in r.meds[0]), 'no dismissed field — fill-required, no dismiss escape');
}

// ── missing duration → marked, blocked ──
{
  const r = computeMedsReview([fullMed({ duration: '' })]);
  assert(r.meds[0].missing.includes('duration'), 'missing duration marked');
  assert(r.needs_review === true, 'blocked while missing');
}

// ── missing form (the new component) → marked, blocked ──
{
  const r = computeMedsReview([fullMed({ form: '' })]);
  assert(r.meds[0].missing.includes('form'), 'missing form marked');
  assert(r.needs_review === true, 'missing form blocks');
}

// ── fill clears ──
console.log('\nfill (the only way to resolve)');
{
  let r = computeMedsReview([fullMed({ duration: '' })]);
  assert(r.needs_review === true, 'starts blocked');
  r = computeMedsReview([fullMed({ duration: '7 дни' })]);
  assert(r.needs_review === false, 'fill clears');
}

// ── free-text values fill fine (no numeric format forced) ──
{
  const r = computeMedsReview([fullMed({ dose: 'тънък слой', duration: 'при нужда' })]);
  assert(r.needs_review === false, 'free-text dose/duration count as filled');
  assert(r.meds[0].missing.length === 0, 'no missing for free-text values');
}

// ── re-empty a previously-filled component re-blocks ──
{
  let r = computeMedsReview([fullMed({ duration: '5 дни' })]);
  assert(r.needs_review === false, 'filled → clear');
  r = computeMedsReview([fullMed({ duration: '' })]);
  assert(r.needs_review === true, 'clearing re-blocks');
}

// ── per-med missing is independent (index-aligned, no leak) ──
{
  const meds = [fullMed({ dose: '' }), fullMed({ duration: '' })];
  const r = computeMedsReview(meds);
  assert(r.meds[0].missing.includes('dose') && !r.meds[0].missing.includes('duration'), 'med 0 misses only dose');
  assert(r.meds[1].missing.includes('duration') && !r.meds[1].missing.includes('dose'), 'med 1 misses only duration');
  assert(r.needs_review === true, 'blocked while either is missing');
}

// ── no meds → not blocked ──
{
  const r = computeMedsReview([]);
  assert(r.needs_review === false, 'empty list passes');
  assert(r.meds.length === 0, 'meds review is empty');
}

// ── medsBlockMessage — present, and offers no skip ──
console.log('\nblock message');
{
  const msg = medsBlockMessage();
  assert(typeof msg === 'string' && msg.length > 0, 'returns a localized message');
  assert(!/пропусн/i.test(msg), 'message no longer offers a dismiss/skip path');
}

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
