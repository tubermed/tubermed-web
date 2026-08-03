// Deterministic diagnosis-term helpers (lib/diagnosis.ts): official-term-wins
// filing + the "доктор каза" divergence classifier.
//
// Run: npm run test   (node --test, Node 24 strips the types natively.)
//
// ⚠ Was `scripts/diagnosis-term.ts` — a standalone `npx tsx` script that
// `npm test` never globbed AND whose extensionless import Node's ESM resolver
// refuses, so it could not even load. Its assertions had not run in any gate.
// Converted 2026-08-03 while `mainDiagnosisPresentation` landed beside them:
// a test that cannot execute is a gate that checks nothing.
//
// These cover the two primitives that survive the presentation refactor.
// The filed-block presentation itself is pinned in diagnosis-presentation.test.ts.

import { test } from 'node:test';
import assert from 'node:assert';
import { filedMainTerm, filedComorbidityTerm, spokenDivergesFromOfficial } from '../lib/diagnosis.ts';

test('filed main term: the official МКБ term wins over the spoken wording', () => {
  assert.equal(
    filedMainTerm({
      osnovna_mkb: 'I10',
      osnovna_mkb_term: 'Есенциална [първична] хипертония',
      osnovna_diagnoza: 'първична хипертония',
    }),
    'Есенциална [първична] хипертония',
  );
});

test('filed main term: falls back to the spoken wording when no official term resolved', () => {
  assert.equal(filedMainTerm({ osnovna_diagnoza: 'нещо' }), 'нещо');
});

test('filed comorbidity term: the official term wins', () => {
  assert.equal(
    filedComorbidityTerm({ mkb: 'E11', mkb_term: 'Неинсулинозависим захарен диабет', diagnoza: 'диабет' }),
    'Неинсулинозависим захарен диабет',
  );
});

test('filed comorbidity term: falls back to the spoken wording', () => {
  assert.equal(filedComorbidityTerm({ mkb: '', diagnoza: 'нещо' }), 'нещо');
});

test('divergence classifier: a contained rewording is benign', () => {
  assert.equal(
    spokenDivergesFromOfficial('първична хипертония', 'Есенциална [първична] хипертония'),
    false,
  );
});

test('divergence classifier: a genuine wrong-code mismatch diverges', () => {
  assert.equal(spokenDivergesFromOfficial('навехнат глезен', 'Контузия на глезена'), true);
});

test('divergence classifier: exact match, empty spoken and absent official term all classify false', () => {
  assert.equal(spokenDivergesFromOfficial('Астма', 'Астма'), false);
  assert.equal(spokenDivergesFromOfficial('', 'Астма'), false);
  assert.equal(spokenDivergesFromOfficial('диабет', ''), false);
});
