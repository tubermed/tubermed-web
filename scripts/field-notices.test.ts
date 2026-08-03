// ─────────────────────────────────────────────────────────────────────────────
// lib/field-notices.ts — the frontend mirror of backend lib/field-notices.js.
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm run test   (node --test, Node 24 strips the types natively.)
//
// WHAT THIS MIRROR IS FOR — and what it deliberately is NOT:
//
//  ✔ Rendering. NOTICE_LABELS is the frozen Bulgarian table, keyed by the enum,
//    and it must stay word-identical to the backend's.
//  ✔ Re-anchoring. The client posts the FULL fields object; between a local
//    edit and the /edit round-trip an index can point at a different allergen.
//    `reanchorFieldNotices` is the same pure index-following logic the server
//    runs, so nothing stale is ever RENDERED — it needs no transcript.
//
//  ✘ Deriving. New notices are never authored client-side. Derivation needs the
//    transcript and is the server's job; a browser that could mint a notice
//    would be a second, unguarded channel into a surface whose whole containment
//    argument is that only one place can write it.
//
//  ✘ Acknowledgement. Ack state lives in the client store, NEVER in `fields` —
//    `fields` is what /edit persists, and an ack written there would become part
//    of the medical record and would round-trip into ai_original_fields' sibling.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  NOTICE_LABELS,
  NOTICE_CODES,
  noticeLabel,
  reanchorFieldNotices,
  noticeDismissKey,
} from '../lib/field-notices.ts';
import type { TranscribeFields, FieldNotice } from '../lib/types.ts';

const notice = (index: number): FieldNotice => ({
  code: 'allergen_no_anchor',
  ref: { field: 'alergii', index },
});

test('the label table is frozen and covers every enum code', () => {
  for (const c of NOTICE_CODES) {
    assert.ok(typeof NOTICE_LABELS[c] === 'string' && NOTICE_LABELS[c].length > 0);
  }
  assert.ok(Object.isFrozen(NOTICE_LABELS));
});

test('the label is word-identical to the backend table', () => {
  // ⚠ If this fails, the cross-repo mirror has drifted. Fix BOTH repos.
  assert.equal(NOTICE_LABELS.allergen_no_anchor, 'записан без опора в транскрипта');
});

test('the rendered line names our own extracted allergen and states document state', () => {
  const f: TranscribeFields = { alergii: ['пеницилин'] };
  const s = noticeLabel(notice(0), f);
  assert.equal(s, 'пеницилин — записан без опора в транскрипта.');
});

test('a notice whose row no longer exists renders nothing rather than a wrong name', () => {
  assert.equal(noticeLabel(notice(3), { alergii: ['пеницилин'] }), null);
});

test('an unknown code renders nothing — no free text can reach the screen', () => {
  const rogue = { code: 'patient_probably_fine', ref: { field: 'alergii', index: 0 } };
  assert.equal(noticeLabel(rogue as unknown as FieldNotice, { alergii: ['пеницилин'] }), null);
});

test('re-anchor: a deleted row does not leave an index pointing at another allergen', () => {
  const prev: TranscribeFields = {
    alergii: ['пеницилин', 'сулфонамиди'],
    field_notices: [notice(0), notice(1)],
  };
  const next: TranscribeFields = { alergii: ['сулфонамиди'] };
  const out = reanchorFieldNotices(prev, next);
  assert.equal(out.length, 1);
  assert.equal(next.alergii![out[0].ref.index], 'сулфонамиди');
});

test('re-anchor: a reordered row keeps its own notice', () => {
  const prev: TranscribeFields = {
    alergii: ['пеницилин', 'сулфонамиди'],
    field_notices: [notice(0)],
  };
  const next: TranscribeFields = { alergii: ['сулфонамиди', 'пеницилин'] };
  const out = reanchorFieldNotices(prev, next);
  assert.equal(out.length, 1);
  assert.equal(next.alergii![out[0].ref.index], 'пеницилин');
});

test('re-anchor: correcting the allergen clears its notice', () => {
  const prev: TranscribeFields = { alergii: ['пеницилин'], field_notices: [notice(0)] };
  const out = reanchorFieldNotices(prev, { alergii: ['цефалоспорини'] });
  assert.deepEqual(out, []);
});

test('re-anchor never authors a notice that was not already there', () => {
  const out = reanchorFieldNotices({ alergii: ['пеницилин'] }, { alergii: ['пеницилин'] });
  assert.deepEqual(out, []);
});

test('re-anchor tolerates a malformed or absent prior array', () => {
  assert.deepEqual(reanchorFieldNotices({}, { alergii: ['x'] }), []);
  assert.deepEqual(
    reanchorFieldNotices({ field_notices: 'nope' } as unknown as TranscribeFields, { alergii: ['x'] }),
    [],
  );
});

test('re-anchor returns a new array and does not mutate the note it is given', () => {
  // Ack state and render state are the client's business; `fields` is what
  // /edit persists, so this helper must never write into it.
  const next: TranscribeFields = { alergii: ['пеницилин'] };
  const prev: TranscribeFields = { alergii: ['пеницилин'], field_notices: [notice(0)] };
  reanchorFieldNotices(prev, next);
  assert.equal(next.field_notices, undefined, 'reanchor must not write into fields');
});

// ── Dismissal keys (the render surface, 2026-08-03) ─────────────────────────
//
// A dismissal is keyed on the allergen TEXT, never on ref.index. This is the
// one place the UI could quietly go wrong in a way nobody would report: delete
// a row above a dismissed notice and an index-keyed dismissal slides onto a
// DIFFERENT allergen, hiding a notice the doctor never saw — on the field where
// a wrong value travels furthest.

test('a dismissal key follows the allergen text, not its position', () => {
  const before = ['пеницилин', 'сулфонамиди'];
  const after  = ['сулфонамиди'];                       // first row deleted
  // Same allergen, different index → same key.
  assert.equal(
    noticeDismissKey(notice(1), before),
    noticeDismissKey(notice(0), after),
  );
});

test('dismissing one allergen does not dismiss another', () => {
  const allergens = ['пеницилин', 'сулфонамиди'];
  assert.notEqual(noticeDismissKey(notice(0), allergens), noticeDismissKey(notice(1), allergens));
});

test('a dismissal key is case- and whitespace-insensitive', () => {
  assert.equal(
    noticeDismissKey(notice(0), ['  Пеницилин ']),
    noticeDismissKey(notice(0), ['пеницилин']),
  );
});

test('an unknown code or a missing row yields no key', () => {
  assert.equal(noticeDismissKey(notice(9), ['пеницилин']), '');
  const rogue = { code: 'patient_probably_fine', ref: { field: 'alergii', index: 0 } };
  assert.equal(noticeDismissKey(rogue as unknown as FieldNotice, ['пеницилин']), '');
});
