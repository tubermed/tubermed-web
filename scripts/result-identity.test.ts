// ─────────────────────────────────────────────────────────────────────────────
// lib/result-identity.ts — the result page's one-identity rule.
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm run test   (node --test, Node 24 strips the types natively.)
//
// THE INVARIANT THESE TESTS PIN (P0 2026-07-29): the ?visit= id in the URL is
// the page's identity. The sessionStorage blob (tuber_last_result) and the
// pending-visit context (tuber_pending_visit) outlive their own visit — only
// „+ Нова консултация" clears them — so opening ANOTHER consultation by URL
// used to paint a chimera: the previous visit's header + transcript under the
// URL row's sealed+approved lifecycle, with every mutating call (/edit,
// /approve, /seal, /erase, /export) aimed at the PREVIOUS visit's row. A
// doctor could edit note B on screen and silently overwrite note A, or see a
// fresh unapproved note render as „Потвърден и затворен". Reproduced against
// a stubbed backend before the fix; these tests keep the door shut.

import { test } from 'node:test';
import assert from 'node:assert';
import { resolveResultBootstrap } from '../lib/result-identity.ts';

const A = 'aaaaaaaa-1111-2222-3333-444444444444';
const S = 'ssssssss-1111-2222-3333-444444444444';

const blobFor = (id: string) =>
  JSON.stringify({ consultationId: id, transcript: 'т', fields: { anamneza: 'x' } });
const pvFor = (id: string) =>
  JSON.stringify({
    consultation_id: id,
    created_at: '2026-07-29T07:37:02.722Z',
    visit_metadata: { chief_complaint: null, visit_type: null, note_type: 'consultation' },
  });

// ── The P0 case: blob from another consultation is NEVER painted ────────────
test('blob for visit A + URL for visit S → recover S, blob ignored', () => {
  const d = resolveResultBootstrap(blobFor(A), pvFor(A), S);
  assert.deepStrictEqual(d, { mode: 'recover', visitId: S });
});

test('matching blob and URL → paint, reconcile armed against the same id', () => {
  const d = resolveResultBootstrap(blobFor(A), pvFor(A), A);
  assert.strictEqual(d.mode, 'paint');
  if (d.mode !== 'paint') return;
  assert.strictEqual(d.result.consultationId, A);
  assert.strictEqual(d.reconcileVisitId, A);
  // The write target and the reconcile target are the SAME consultation — the
  // property whose violation was the P0.
  assert.strictEqual(d.result.consultationId, d.reconcileVisitId);
});

// ── The pending-visit header obeys the same rule ────────────────────────────
test('pending visit from another consultation is dropped', () => {
  const d = resolveResultBootstrap(blobFor(A), pvFor(S), A);
  assert.strictEqual(d.mode, 'paint');
  if (d.mode !== 'paint') return;
  assert.strictEqual(d.pendingVisit, null);
});

test('pending visit for the same consultation rides along', () => {
  const d = resolveResultBootstrap(blobFor(A), pvFor(A), A);
  assert.strictEqual(d.mode, 'paint');
  if (d.mode !== 'paint') return;
  assert.strictEqual(d.pendingVisit?.consultation_id, A);
});

test('malformed pending visit → paint without a header, never a throw', () => {
  const d = resolveResultBootstrap(blobFor(A), '{not json', A);
  assert.strictEqual(d.mode, 'paint');
  if (d.mode !== 'paint') return;
  assert.strictEqual(d.pendingVisit, null);
});

// ── Cold start and degenerate blobs ─────────────────────────────────────────
test('no blob + URL id → recover', () => {
  assert.deepStrictEqual(resolveResultBootstrap(null, null, S), {
    mode: 'recover',
    visitId: S,
  });
});

test('no blob + no URL id → bounce', () => {
  assert.deepStrictEqual(resolveResultBootstrap(null, null, null), { mode: 'bounce' });
});

test('malformed blob + URL id → recover (the URL still knows the visit)', () => {
  assert.deepStrictEqual(resolveResultBootstrap('{broken', pvFor(A), S), {
    mode: 'recover',
    visitId: S,
  });
});

test('malformed blob + no URL id → bounce', () => {
  assert.deepStrictEqual(resolveResultBootstrap('{broken', null, null), { mode: 'bounce' });
});

test('blob without a consultationId is treated as unusable, not painted', () => {
  const legacy = JSON.stringify({ transcript: 'т', fields: { anamneza: 'x' } });
  assert.deepStrictEqual(resolveResultBootstrap(legacy, null, S), {
    mode: 'recover',
    visitId: S,
  });
});

// ── Legacy no-?visit= flow: blob paints, ids are consistent by construction ─
test('blob + no URL id → paint with no reconcile (screen and writes share the blob id)', () => {
  const d = resolveResultBootstrap(blobFor(A), pvFor(A), null);
  assert.strictEqual(d.mode, 'paint');
  if (d.mode !== 'paint') return;
  assert.strictEqual(d.result.consultationId, A);
  assert.strictEqual(d.reconcileVisitId, null);
});
