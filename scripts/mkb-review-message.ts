// Standalone assertions for the МКБ reconcile gate's reason→copy mapping
// (lib/mkb-review.ts). The web repo has no unit-test runner; run as tsx from the
// tubermed-web root:  npx tsx scripts/mkb-review-message.ts
//
// P0-01b: the backend now emits mkb_review.reason === 'diagnosis_text_not_grounded'
// when the MAIN diagnosis isn't supported by the transcript. The code is VALID;
// only the diagnosis is unsupported — the copy must NOT call the code invalid and
// must NOT tell the doctor to fix the code. missing_code / invalid_code copy must
// stay byte-identical to today.

import { mkbReviewCopy } from '../lib/mkb-review';
import type { MkbReview } from '../lib/types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('  ✓ ' + msg); passed++; }
  else { console.error('  ✗ ' + msg); failed++; }
}

// ── the bug: a grounding flag must NOT be labelled "invalid code" ──
console.log('diagnosis_text_not_grounded → must point at the diagnosis, not the code');
{
  const review: MkbReview = { needs_review: true, reason: 'diagnosis_text_not_grounded', code: 'E00.2' };
  const c = mkbReviewCopy(review);
  assert(!c.blockMessage.includes('не е валиден'), 'blockMessage does NOT say the code is invalid');
  assert(!c.blockMessage.includes('Невалиден') && !c.bannerTitle.includes('Невалиден'),
    'copy does NOT use "Невалиден"');
  assert(!c.bannerTitle.includes('код'), 'banner title is about the diagnosis, not the код');
  assert(c.blockMessage.includes('диагноза'), 'blockMessage references the диагноза');
  assert(/разговор|казан|обсъд/.test(c.blockMessage),
    'blockMessage references what was said/discussed in the visit');
}

// ── missing_code copy unchanged (byte-identical) ──
console.log('missing_code → unchanged');
{
  const c = mkbReviewCopy({ needs_review: true, reason: 'missing_code', code: '' });
  assert(
    c.blockMessage === 'Липсва код по МКБ-10 за основната диагноза. Добавете валиден код преди потвърждаване.',
    'missing_code blockMessage byte-identical',
  );
  assert(c.bannerTitle === 'Липсва код по МКБ-10', 'missing_code bannerTitle byte-identical');
  assert(
    c.bannerDetail === 'Изберете диагноза от МКБ-10 (търсете или 🔍). Потвърждаването и експортът са блокирани, докато липсва код.',
    'missing_code bannerDetail byte-identical',
  );
}

// ── invalid_code copy unchanged (byte-identical) ──
console.log('invalid_code → unchanged');
{
  const c = mkbReviewCopy({ needs_review: true, reason: 'invalid_code', code: 'ZZZ.9' });
  assert(
    c.blockMessage === 'Кодът по МКБ-10 „ZZZ.9“ не е валиден. Коригирайте основната диагноза преди потвърждаване.',
    'invalid_code blockMessage byte-identical',
  );
  assert(c.bannerTitle === 'Невалиден код по МКБ-10', 'invalid_code bannerTitle byte-identical');
  assert(
    c.bannerDetail === 'Кодът „ZZZ.9“ не е в МКБ-10 регистъра. Изберете валиден (търсете или 🔍). Потвърждаването и експортът са блокирани.',
    'invalid_code bannerDetail byte-identical',
  );
  // the osnovna_mkb fallback for the banner code (when review.code is empty)
  const c2 = mkbReviewCopy({ needs_review: true, reason: 'invalid_code' }, 'Q99.9');
  assert(c2.bannerDetail.includes('„Q99.9“'), 'invalid_code banner falls back to osnovna_mkb for the code');
}

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
