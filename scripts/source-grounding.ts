// Standalone test for the deterministic source-grounding matcher
// (lib/source-grounding.ts): maps a structured field value back to the char
// range in the RAW consultation transcript it most likely came from. The matcher
// is precision-favoring — a confident span or null (showing the wrong source is
// worse than showing none). No API, no test runner.
// Run from the tubermed-web root: npx tsx scripts/source-grounding.ts

import { findSourceSpan } from '../lib/source-grounding';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string) {
  if (c) { console.log('  ✓ ' + m); passed++; }
  else { console.error('  ✗ ' + m); failed++; }
}

// Helper: the transcript substring a span points at (or null for no match).
function slice(fieldKey: string, value: string, transcript: string): string | null {
  const r = findSourceSpan(fieldKey, value, transcript);
  return r ? transcript.slice(r.start, r.end) : null;
}

// ── Diagnosis: match on the TERM, never the МКБ code ──
{
  const t = 'Пациентът съобщава за първична хипертония от няколко години.';
  // em-dash code suffix is stripped before matching
  const s1 = slice('osnovna_diagnoza', 'Есенциална [първична] хипертония — I10', t);
  assert(s1 !== null && s1.includes('първична') && s1.includes('хипертония'),
    'diagnosis with em-dash code: matches on term (първична хипертония)');
  // parenthesized code suffix is stripped before matching
  const s2 = slice('osnovna_diagnoza', 'Есенциална хипертония (I10)',
    'Диагнозата е есенциална хипертония, добре контролирана.');
  assert(s2 !== null && s2.includes('есенциална') && s2.includes('хипертония'),
    'diagnosis with parenthesized code: matches on term');
}

// ── The МКБ code is NOT the matching signal ──
assert(
  findSourceSpan('osnovna_diagnoza', 'Есенциална хипертония — I10', 'Пациент с код I10 в картона.') === null,
  'code present in transcript but term absent → null (code never drives the match)',
);

// ── Clearly-present phrase → sane range covering the phrase ──
{
  const t = 'Болният се оплаква от болки в гърлото вече три дни.';
  const s = slice('anamneza', 'болки в гърлото', t);
  assert(s !== null && s.includes('болки') && s.includes('гърлото'),
    'present phrase → range covers the phrase');
}

// ── Value absent from transcript → null ──
assert(
  findSourceSpan('anamneza', 'остра бъбречна недостатъчност', 'Пациентът има болки в гърлото и кашлица.') === null,
  'value absent from transcript → null',
);

// ── Single distinctive word present → match; single short word → null ──
assert(
  slice('osnovna_diagnoza', 'Хипертония', 'Прегледът показва данни за хипертония.') !== null,
  'single distinctive word (≥6 chars) present → match',
);
assert(
  findSourceSpan('osnovna_diagnoza', 'Грип', 'Пациентът има грип и температура.') === null,
  'single short word (<6 chars) alone → null (precision)',
);

// ── Two content tokens, only one present → null (precision) ──
assert(
  findSourceSpan('anamneza', 'артериална хипертония', 'Открихме данни за хипертония.') === null,
  'two content tokens but only one present → null',
);

// ── Wrong-code catch: the spoken phrasing is what lives in the transcript ──
{
  const t = 'При прегледа установих навехнат глезен след падане.';
  const s = slice('osnovna_diagnoza', 'навехнат глезен', t);
  assert(s !== null && s.includes('навехнат') && s.includes('глезен'),
    'spoken "навехнат глезен" → matches (lets the doctor catch a wrong official term)');
}

// ── Empty inputs → null ──
assert(findSourceSpan('anamneza', 'болки в гърлото', '') === null, 'empty transcript → null');
assert(findSourceSpan('anamneza', '', 'болки в гърлото') === null, 'empty value → null');

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
