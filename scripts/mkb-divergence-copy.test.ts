// ─────────────────────────────────────────────────────────────────────────────
// mkb_review.divergence_advisory → the one line a doctor reads when the filed
// МКБ-10 term contradicts what they dictated.
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm run test
//
// The backend already detects the mismatch („стенокардия при усилие, съмнение
// за стабилна форма" ↔ I24.9 „Остра исхемична болест на сърцето") and records
// it; until 2026-08-22 nothing read the field. This is a DISCLOSURE, not a
// gate: needs_review stays whatever it was, approval/export are untouched.
// It names both sides and nothing else — a statement about the RECORD.

import { test } from 'node:test';
import assert from 'node:assert';
import { mkbDivergenceCopy } from '../lib/mkb-review.ts';

const TERM = 'Остра исхемична болест на сърцето';
const SAID = 'стенокардия при усилие, съмнение за стабилна форма';
const diverged = { needs_review: false, divergence_advisory: { diverged: true, term: TERM, diagnoza: SAID } };

test('a diverged advisory names both the dictated phrasing and the filed term', () => {
  const text = mkbDivergenceCopy(diverged, TERM);
  assert.ok(text, 'expected copy');
  assert.ok(text!.includes(SAID), 'the doctor must see what they said');
  assert.ok(text!.includes(TERM), 'and what was filed');
});

test('absent field, diverged:false, or no mkb_review at all render nothing', () => {
  assert.equal(mkbDivergenceCopy(undefined, TERM), null);
  assert.equal(mkbDivergenceCopy(null, TERM), null);
  assert.equal(mkbDivergenceCopy({ needs_review: false }, TERM), null);
  assert.equal(
    mkbDivergenceCopy({ needs_review: false, divergence_advisory: { diverged: false, term: TERM, diagnoza: SAID } }, TERM),
    null,
  );
});

test('a truthy-but-not-true diverged flag renders nothing (the contract is boolean true)', () => {
  const r = { needs_review: false, divergence_advisory: { diverged: 'true' as unknown as boolean, term: TERM, diagnoza: SAID } };
  assert.equal(mkbDivergenceCopy(r, TERM), null);
});

test('a one-sided advisory renders nothing — quoting an empty dictation would mislead', () => {
  assert.equal(mkbDivergenceCopy({ needs_review: false, divergence_advisory: { diverged: true, term: TERM, diagnoza: '' } }, TERM), null);
  assert.equal(mkbDivergenceCopy({ needs_review: false, divergence_advisory: { diverged: true, term: '', diagnoza: SAID } }, ''), null);
  assert.equal(mkbDivergenceCopy({ needs_review: false, divergence_advisory: { diverged: true, term: '  ', diagnoza: '  ' } }, TERM), null);
});

test('an advisory about a term that is no longer the filed term renders nothing (stale guard)', () => {
  // The doctor repicked the code client-side; a stale advisory must not describe
  // a term that is not on the note any more.
  assert.equal(mkbDivergenceCopy(diverged, 'Стенокардия'), null);
  assert.equal(mkbDivergenceCopy(diverged, ''), null);
  // Whitespace/case drift between the two copies of the same term is not staleness.
  assert.ok(mkbDivergenceCopy(diverged, `  ${TERM.toUpperCase()} `));
});

test('the advisory does not claim the code is invalid or blocked', () => {
  const text = mkbDivergenceCopy(diverged, TERM)!;
  assert.ok(!/невалид|блокиран/i.test(text), 'that vocabulary belongs to the needs_review gate');
});

// ── Nothing new in copy / export / print ─────────────────────────────────────
// The disclosure is a SCREEN surface. The three exporters (clipboard plain
// text, PDF HTML, Word HTML) must not carry the advisory or its wording.
import Module from 'node:module';
import type { TranscribeFields } from '../lib/types.ts';
type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = Module as unknown as {
  registerHooks: (hooks: { resolve: (s: string, c: unknown, n: NextResolve) => unknown }) => void;
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (err) {
      if (specifier.startsWith('.') && !specifier.endsWith('.ts')) return nextResolve(specifier + '.ts', context);
      throw err;
    }
  },
});
const { formatPlainText, generatePdfHtml, generateWordHtml } = await import('../lib/exporters.ts');

test('the advisory never reaches clipboard, PDF or Word output', () => {
  const f = {
    anamneza: 'Болка в гърдите при усилие.',
    osnovna_diagnoza: SAID,
    osnovna_mkb: 'I24.9',
    osnovna_mkb_term: TERM,
    pridruzhavashti: [],
    mkb_review: diverged,
  } as unknown as TranscribeFields;
  const screen = mkbDivergenceCopy(diverged, TERM)!;
  for (const out of [formatPlainText(f), generatePdfHtml(f, '22.08.2026'), generateWordHtml(f, '22.08.2026')]) {
    assert.ok(!out.includes(screen), 'the screen sentence must not be exported');
    assert.ok(!/разминава/.test(out), 'nor any fragment of it');
    assert.ok(!/divergence/.test(out), 'nor the raw field');
  }
});
