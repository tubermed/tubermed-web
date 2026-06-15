// Standalone unit test for patientSummaryLimitFromError (lib/api.ts) — the
// detection layer that lifts the B5 cost-control HTTP 429s off an ApiError so
// PatientSummaryModal can show them as a calm notice instead of a red error.
//
// Backend contract (tubermed-backend/routes/consultations.js POST
// /:id/patient-summary): two 429 shapes, each a Bulgarian `error` + a machine
// `code`; the regen cooldown ALSO carries `retry_after_seconds`. Any other
// failure (incl. a 429 with an unknown code) must fall through to null so the
// generic error channel still handles it.
//
// The web repo has no unit-test runner; logic regressions run as standalone tsx.
// Run from the tubermed-web root: npx tsx scripts/patient-summary-limit.ts

import { ApiError, patientSummaryLimitFromError } from '../lib/api';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('  ✓ ' + msg); passed++; }
  else { console.error('  ✗ ' + msg); failed++; }
}

// ── daily cap: real backend body (no retry_after_seconds) ──
{
  const msg = 'Достигнат е дневният лимит за резюмета. Опитайте утре.';
  const err = new ApiError(429, msg, { error: msg, code: 'patient_summary_daily_limit' });
  const limit = patientSummaryLimitFromError(err);
  assert(limit !== null, 'daily-limit 429 is recognised');
  assert(limit?.code === 'patient_summary_daily_limit', 'daily-limit code passed through');
  assert(limit?.message === msg, 'daily-limit message is the backend Bulgarian string');
  assert(limit?.retryAfterSeconds === undefined, 'daily-limit carries no retryAfterSeconds');
}

// ── regen cooldown: real backend body (carries retry_after_seconds) ──
{
  const msg = 'Резюмето е генерирано току-що. Опитайте отново след малко.';
  const err = new ApiError(429, msg, {
    error: msg,
    code: 'patient_summary_regen_cooldown',
    retry_after_seconds: 42,
  });
  const limit = patientSummaryLimitFromError(err);
  assert(limit !== null, 'regen-cooldown 429 is recognised');
  assert(limit?.code === 'patient_summary_regen_cooldown', 'regen-cooldown code passed through');
  assert(limit?.message === msg, 'regen-cooldown message is the backend Bulgarian string');
  assert(limit?.retryAfterSeconds === 42, 'regen-cooldown retryAfterSeconds read off the body');
}

// ── a 429 with an UNKNOWN code → falls through to generic (null) ──
{
  const err = new ApiError(429, 'Твърде много заявки.', { error: 'x', code: 'some_other_limit' });
  assert(patientSummaryLimitFromError(err) === null, 'unknown-code 429 falls through to generic');
}

// ── a 429 with no machine code at all → null ──
{
  const err = new ApiError(429, 'Twърде много', { error: 'x' });
  assert(patientSummaryLimitFromError(err) === null, '429 without a code falls through');
}

// ── a 429 with a null/absent body → null (defensive) ──
{
  assert(patientSummaryLimitFromError(new ApiError(429, 'oops', null)) === null, '429 with null body → null');
  assert(patientSummaryLimitFromError(new ApiError(429, 'oops')) === null, '429 with no body → null');
}

// ── a non-429 ApiError carrying the same code → null (status gate) ──
{
  const err = new ApiError(403, 'blocked', { code: 'patient_summary_daily_limit' });
  assert(patientSummaryLimitFromError(err) === null, 'matching code on a non-429 is ignored');
}

// ── a non-ApiError (network/parse) → null ──
{
  assert(patientSummaryLimitFromError(new Error('network down')) === null, 'plain Error → null');
  assert(patientSummaryLimitFromError(null) === null, 'null → null');
  assert(patientSummaryLimitFromError('429') === null, 'string → null');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
