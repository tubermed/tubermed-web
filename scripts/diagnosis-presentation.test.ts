// ─────────────────────────────────────────────────────────────────────────────
// lib/diagnosis.ts — mainDiagnosisPresentation(): one shared shape for the
// diagnosis block on screen, in the PDF, in the Word doc and on the clipboard.
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm run test   (node --test, Node 24 strips the types natively.)
//
// WHAT THESE TESTS PIN (2026-08-03 ruling):
//
//  1. The амбулаторен лист is an НЗОК primary document. What gets FILED is the
//     official register term + code — that pair is what a reviewer anchors on.
//     A hedged dictation („най-вероятно вирусен фарингит") is a sentence, not a
//     term, and never becomes the filed term when a code resolved.
//
//  2. The dictated wording is ALWAYS carried, on its own attributed line
//     beneath. It is never hidden because the two strings happen to coincide —
//     an attribution that disappears on some notes teaches a reader to distrust
//     its absence on the rest.
//
//  3. The no-official-code case is a DIFFERENT STATE, not a coincidental match.
//     There is no register term at all and the filed term falls back to the
//     dictated wording; printing the identical string twice reads as a bug, and
//     a doctor who thinks the tool is glitching stops reading the attribution
//     everywhere else. It renders one line carrying an explicit marker instead.
//
//  4. That state is branched on the STRUCTURAL fact (no official term / term
//     sourced from the dictation), NEVER by comparing the two strings — so a
//     future note where the strings coincide for real reasons cannot silently
//     lose its cue. The `structural, not by comparison` test below is the one
//     that fails if anyone reintroduces an equality check.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  mainDiagnosisPresentation,
  spokenDivergesFromOfficial,
  NO_OFFICIAL_CODE_NOTE,
  NO_DICTATION_NOTE,
  PARENT_RUBRIC_NOTE,
} from '../lib/diagnosis.ts';
import type { TranscribeFields } from '../lib/types.ts';

const f = (o: Partial<TranscribeFields>): TranscribeFields => o as TranscribeFields;

// ── The ordinary case: exact register term, divergent dictation ──────────────

test('files the official term + code, and attributes the dictated wording beneath', () => {
  const p = mainDiagnosisPresentation(
    f({
      osnovna_mkb: 'I10',
      osnovna_mkb_term: 'Есенциална [първична] хипертония',
      osnovna_mkb_term_source: 'exact',
      osnovna_diagnoza: 'първична хипертония',
    }),
  );

  assert.equal(p.term, 'Есенциална [първична] хипертония');
  assert.equal(p.code, 'I10');
  assert.equal(p.termSource, 'official');
  assert.equal(p.provenance, 'dictated');
  assert.equal(p.attributionLine, 'доктор каза: първична хипертония');
  assert.equal(p.parentRubric, false);
  assert.equal(p.parentRubricLine, '');
});

// ── Rule 2: presence is unconditional ────────────────────────────────────────

test('carries the attribution even when the dictated wording matches the official term', () => {
  const p = mainDiagnosisPresentation(
    f({
      osnovna_mkb: 'J45',
      osnovna_mkb_term: 'Астма',
      osnovna_mkb_term_source: 'exact',
      osnovna_diagnoza: 'Астма',
    }),
  );

  // Identical strings — the OLD screen cue suppressed the line here. It must not.
  assert.equal(p.provenance, 'dictated');
  assert.equal(p.attributionLine, 'доктор каза: Астма');
});

test('carries the attribution for a benign contained rewording', () => {
  const p = mainDiagnosisPresentation(
    f({
      osnovna_mkb: 'I10',
      osnovna_mkb_term: 'Есенциална [първична] хипертония',
      osnovna_diagnoza: 'първична хипертония',
    }),
  );

  // spokenDivergesFromOfficial() says false here — and it no longer gates.
  assert.equal(spokenDivergesFromOfficial('първична хипертония', 'Есенциална [първична] хипертония'), false);
  assert.equal(p.attributionLine, 'доктор каза: първична хипертония');
});

// ── The hedged dictation: a sentence is not a term ───────────────────────────

test('a hedged dictation never becomes the filed term when a code resolved', () => {
  const p = mainDiagnosisPresentation(
    f({
      osnovna_mkb: 'J02.9',
      osnovna_mkb_term: 'Остър фарингит, неуточнен',
      osnovna_mkb_term_source: 'exact',
      osnovna_diagnoza: 'най-вероятно вирусен фарингит, изчакваме резултата от посявката',
    }),
  );

  assert.equal(p.term, 'Остър фарингит, неуточнен');
  assert.equal(
    p.attributionLine,
    'доктор каза: най-вероятно вирусен фарингит, изчакваме резултата от посявката',
  );
});

// ── Fixture 27: parent-rubric acceptance ─────────────────────────────────────

test('fixture 27 — a parent-accepted code carries the rubric line that explains the label', () => {
  // E11.4 is a correct code for „захарен диабет тип 2 с неврологични усложнения".
  // mkb10.json carries only the 3-character rubrics, so the resolver
  // parent-accepts and the printed label is E11's — „Неинсулинозависим захарен
  // диабет". Without the rubric line a doctor reads „Неинсулинозависим" above
  // their own „тип 2 с неврологични усложнения" as a contradiction of their
  // words. It is a category label, and the лист has to say so.
  const p = mainDiagnosisPresentation(
    f({
      osnovna_mkb: 'E11.4',
      osnovna_mkb_term: 'Неинсулинозависим захарен диабет',
      osnovna_mkb_term_source: 'parent',
      osnovna_diagnoza: 'захарен диабет тип 2 с неврологични усложнения',
    }),
  );

  assert.equal(p.term, 'Неинсулинозависим захарен диабет');
  assert.equal(p.code, 'E11.4');
  assert.equal(p.parentRubric, true);
  assert.equal(p.parentRubricLine, PARENT_RUBRIC_NOTE);
  assert.equal(p.attributionLine, 'доктор каза: захарен диабет тип 2 с неврологични усложнения');
});

test('an exact-term match carries no rubric line', () => {
  const p = mainDiagnosisPresentation(
    f({ osnovna_mkb: 'J45', osnovna_mkb_term: 'Астма', osnovna_mkb_term_source: 'exact' }),
  );
  assert.equal(p.parentRubric, false);
  assert.equal(p.parentRubricLine, '');
});

// ── Rule 3 + 4: the no-official-code state ───────────────────────────────────

test('no official term → its own state with an explicit no-code marker, not a duplicated line', () => {
  const p = mainDiagnosisPresentation(
    f({ osnovna_mkb: '', osnovna_diagnoza: 'навяхване на глезена' }),
  );

  assert.equal(p.term, 'навяхване на глезена'); // fallback: the dictation is all there is
  assert.equal(p.code, '');
  assert.equal(p.termSource, 'dictated');
  assert.equal(p.provenance, 'no_official_code');
  assert.equal(p.attributionLine, NO_OFFICIAL_CODE_NOTE);
  // The failure this state exists to prevent: the same string printed twice.
  assert.notEqual(p.attributionLine, `доктор каза: ${p.term}`);
  assert.ok(!p.attributionLine.includes(p.term));
});

test('a code with no register term is still the no-official-code state', () => {
  // An off-register / invalid code resolves no term, so the filed term falls
  // back to the dictation. Structurally identical to the empty-code case.
  const p = mainDiagnosisPresentation(
    f({ osnovna_mkb: 'ZZ99', osnovna_diagnoza: 'навяхване на глезена' }),
  );
  assert.equal(p.provenance, 'no_official_code');
  assert.equal(p.attributionLine, NO_OFFICIAL_CODE_NOTE);
});

test('structural, not by comparison — coinciding strings WITH an official term stay attributed', () => {
  // THE REGRESSION GUARD. If anyone implements the no-code state as
  // `term === spoken`, this note — which has a real register term that happens
  // to equal the dictation — flips to the no-code marker and silently loses its
  // attribution. It must stay `dictated`.
  const p = mainDiagnosisPresentation(
    f({
      osnovna_mkb: 'J45',
      osnovna_mkb_term: 'Астма',
      osnovna_mkb_term_source: 'exact',
      osnovna_diagnoza: 'Астма',
    }),
  );

  assert.equal(p.term, p.spoken); // the strings DO coincide…
  assert.equal(p.provenance, 'dictated'); // …and the state is still the attributed one
  assert.equal(p.attributionLine, 'доктор каза: Астма');
});

test('the G1 placeholder is filed as-is and reads as no official code', () => {
  // G1 blanks an incidental main diagnosis to a placeholder and clears the
  // code. „доктор каза: [диагноза не е продиктувана…]" would be a lie — nothing
  // was dictated. The no-code marker is the honest line.
  const p = mainDiagnosisPresentation(
    f({ osnovna_mkb: '', osnovna_diagnoza: '[диагноза не е продиктувана — добави ръчно]' }),
  );
  assert.equal(p.provenance, 'no_official_code');
  assert.equal(p.attributionLine, NO_OFFICIAL_CODE_NOTE);
});

// ── The doctor picked a code with nothing dictated ───────────────────────────

test('official term with no dictated wording says so, rather than printing an empty cue', () => {
  const p = mainDiagnosisPresentation(
    f({ osnovna_mkb: 'J45', osnovna_mkb_term: 'Астма', osnovna_mkb_term_source: 'exact', osnovna_diagnoza: '' }),
  );

  assert.equal(p.term, 'Астма');
  assert.equal(p.provenance, 'no_dictation');
  assert.equal(p.attributionLine, NO_DICTATION_NOTE);
  assert.ok(!p.attributionLine.startsWith('доктор каза:'));
});

// ── Nothing to render ────────────────────────────────────────────────────────

test('an empty diagnosis has no block at all', () => {
  const p = mainDiagnosisPresentation(f({}));
  assert.equal(p.hasContent, false);
  assert.equal(p.term, '');
  assert.equal(p.attributionLine, '');
});

test('a bare code with no term and no dictation still renders a block', () => {
  const p = mainDiagnosisPresentation(f({ osnovna_mkb: 'J45' }));
  assert.equal(p.hasContent, true);
  assert.equal(p.code, 'J45');
});

// ── Whitespace ───────────────────────────────────────────────────────────────

test('values are trimmed', () => {
  const p = mainDiagnosisPresentation(
    f({ osnovna_mkb: '  I10 ', osnovna_mkb_term: ' Хипертония ', osnovna_diagnoza: '  високо кръвно ' }),
  );
  assert.equal(p.code, 'I10');
  assert.equal(p.term, 'Хипертония');
  assert.equal(p.attributionLine, 'доктор каза: високо кръвно');
});

// ── The dictated wording is the AI-ORIGINAL, not the doctor's later edit ─────

test('an explicit dictated wording is what gets attributed, not the edited field', () => {
  // On screen the component holds both: `fields.osnovna_diagnoza` is live and
  // editable, `original.fields.osnovna_diagnoza` is the immutable snapshot of
  // what was dictated. „доктор каза" must quote the snapshot — quoting the
  // doctor's own later edit back at them attributes it to the dictation.
  const p = mainDiagnosisPresentation(
    f({
      osnovna_mkb: 'I10',
      osnovna_mkb_term: 'Есенциална [първична] хипертония',
      osnovna_diagnoza: 'артериална хипертония', // doctor edited this
    }),
    'високо кръвно налягане', // …but this is what was dictated
  );

  assert.equal(p.term, 'Есенциална [първична] хипертония');
  assert.equal(p.spoken, 'високо кръвно налягане');
  assert.equal(p.attributionLine, 'доктор каза: високо кръвно налягане');
});

test('with no snapshot available the current wording is attributed, never a false no-dictation', () => {
  // A note opened from the library has no AI-original snapshot client-side.
  // Falling through to „без продиктувана формулировка" would assert something
  // untrue; the field we do have is the honest source.
  const p = mainDiagnosisPresentation(
    f({ osnovna_mkb: 'I10', osnovna_mkb_term: 'Хипертония', osnovna_diagnoza: 'високо кръвно' }),
    undefined,
  );
  assert.equal(p.provenance, 'dictated');
  assert.equal(p.attributionLine, 'доктор каза: високо кръвно');
});

test('the no-code fallback term is the CURRENT wording, while attribution stays structural', () => {
  const p = mainDiagnosisPresentation(
    f({ osnovna_mkb: '', osnovna_diagnoza: 'навяхване на глезена' }),
    'навехнат глезен',
  );
  assert.equal(p.term, 'навяхване на глезена'); // what is filed = what is on the note now
  assert.equal(p.spoken, 'навехнат глезен');
  assert.equal(p.provenance, 'no_official_code');
  assert.equal(p.attributionLine, NO_OFFICIAL_CODE_NOTE);
});

// ── spokenDivergesFromOfficial survives, and gates nothing ───────────────────

test('spokenDivergesFromOfficial is still exported and still classifies', () => {
  assert.equal(spokenDivergesFromOfficial('навехнат глезен', 'Контузия на глезена'), true);
  assert.equal(spokenDivergesFromOfficial('първична хипертония', 'Есенциална [първична] хипертония'), false);
  assert.equal(spokenDivergesFromOfficial('', 'Астма'), false);
});
