// ─────────────────────────────────────────────────────────────────────────────
// mkb_correction → the one sentence a doctor reads about a changed code.
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm run test
//
// A code that was silently repaired is a claim nobody can audit later. The
// backend records `{ from, to?, rule }` whenever what it FILED differs from what
// the model EMITTED; this layer turns that into Bulgarian.
//
// THE LINE THIS MUST NOT CROSS — inherited verbatim from field_notices: every
// string states a fact about the RECORD, never about the PATIENT. No severity,
// no risk word, no recommendation about the patient's care. The wording is
// rendered from the closed `rule` enum on THIS side, so the backend cannot widen
// it and the model can never author a word of it.

import { test } from 'node:test';
import assert from 'node:assert';
import type { MkbCorrection } from '../lib/types.ts';
import { mkbCorrectionCopy } from '../lib/mkb-review.ts';

test('a repaired ICD-10-CM code names both the emitted and the filed code', () => {
  const text = mkbCorrectionCopy({ from: 'M17.11', to: 'M17.1', rule: 'icd10cm_truncated' });
  assert.ok(text, 'expected copy');
  assert.ok(text!.includes('M17.11'), 'the doctor must see what was heard');
  assert.ok(text!.includes('M17.1'), 'and what was filed');
  assert.ok(/ICD-10-CM/.test(text!), 'and why — the wrong catalogue');
});

test('a stripped code says plainly that nothing was filed', () => {
  const text = mkbCorrectionCopy({ from: 'ZZZ.9', rule: 'invalid_code_stripped' });
  assert.ok(text!.includes('ZZZ.9'));
  assert.ok(/не беше записан/.test(text!), 'a blank the doctor has to notice unaided is the bug');
});

test('the obstetric strip and remap read differently', () => {
  const remap = mkbCorrectionCopy({ from: 'O10.9', to: 'I10', rule: 'obstetric_no_context' });
  const strip = mkbCorrectionCopy({ from: 'O99.8', rule: 'obstetric_no_context' });
  assert.ok(remap!.includes('I10'));
  assert.ok(!/I10/.test(strip!), 'a strip must not imply a code was filed');
});

test('no correction → no line', () => {
  assert.strictEqual(mkbCorrectionCopy(undefined), null);
  assert.strictEqual(mkbCorrectionCopy(null), null);
  assert.strictEqual(mkbCorrectionCopy({ from: '', rule: 'icd10cm_truncated' } as MkbCorrection), null);
});

test('an unrecognised rule renders NOTHING rather than guessing', () => {
  // A newer backend emitting a rule this build predates must not be able to put
  // an unreviewed sentence on a note. Silence is the safe failure here.
  const rogue = { from: 'A00.1', to: 'A00', rule: 'invented_by_a_future_backend' } as unknown as MkbCorrection;
  assert.strictEqual(mkbCorrectionCopy(rogue), null);
});

test('no copy makes a claim about the PATIENT or carries a severity word', () => {
  const all: MkbCorrection[] = [
    { from: 'M17.11', to: 'M17.1', rule: 'icd10cm_truncated' },
    { from: 'Z87.891', to: 'Z87.8', rule: 'us_only_mapped' },
    { from: 'ZZZ.9', rule: 'invalid_code_stripped' },
    { from: 'O10.9', to: 'I10', rule: 'obstetric_no_context' },
    { from: 'O99.8', rule: 'obstetric_no_context' },
  ];
  // Words that would turn a record-statement into a clinical one.
  const FORBIDDEN = /риск|опасн|критичн|спешн|внимание|предупрежд|тежк|сериозн|вероятно|проверете дали/i;
  for (const c of all) {
    const text = mkbCorrectionCopy(c);
    assert.ok(text, `expected copy for ${c.rule}`);
    assert.ok(!FORBIDDEN.test(text!),
      `"${text}" carries a clinical/severity word — this channel states facts about the RECORD only`);
  }
});

test('every rule the backend can emit has copy — no silent gaps', () => {
  // Mirrors MKB_CORRECTION_RULES in tubermed-backend/lib/process-audio.js. If the
  // backend adds a rule, this fails until the Bulgarian is written — the same
  // cross-repo discipline as the template mirrors.
  const RULES: MkbCorrection['rule'][] = [
    'icd10cm_truncated', 'us_only_mapped', 'invalid_code_stripped', 'obstetric_no_context',
  ];
  for (const rule of RULES) {
    assert.ok(mkbCorrectionCopy({ from: 'X00.11', to: 'X00.1', rule }),
      `rule "${rule}" renders nothing — a code changed and the note would say why only for some rules`);
  }
});
