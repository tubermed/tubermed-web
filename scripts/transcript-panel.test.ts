// scripts/transcript-panel.test.ts — „Транскриптът е празен." is a report about
// the RECORD, and on a reopened note nothing had been fetched to report on
// (2026-08-27)
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
// This is the last visible instance of the defect the source-label suppression
// was built around (`scripts/source-label.test.ts`, „the three silences").
//
// Every note reopened from the library (`?visit=`), every reload, every cold
// start rebuilds the page from GET /api/consultations/:id — which does not
// select `transcript` at all, by design (backend routes/consultations.js,
// DETAIL_COLS). The client filled the hole with `transcript: ''`, and the
// transcript panel read that zero length as a fact about the consultation:
//
//     Транскриптът е празен.        („The transcript is empty.")
//
// It is not. It is a report about a fetch that never happened, phrased as a
// verdict about the record — and a doctor reads it as „the recording was lost".
// That is worse than the source label was: the label said we could not trace a
// field, this says the visit has no transcript at all.
//
// ── THE DISTINCTION ────────────────────────────────────────────────────────
// „We haven't loaded it" and „it is empty" are different statements and only
// the first one is true on a reopened note. The code could not tell them apart
// — BOTH were the empty string — so the fix is to make the absence
// representable: `TranscribeResult.transcript` is `string | null`, and `null`
// means „no transcript value was ever obtained". `''` keeps its literal
// meaning: fetched, and really is empty. The three states each get their own
// rendering and lib/transcript-state.ts is the only place that decides which.
//
// ⚠ MEASURED, and it belongs in the record: „fetched and genuinely empty" has
// NO producer in the product today. The async path throws `no_speech` on a
// transcript that trims to nothing (backend lib/process-audio.js ~534) and the
// streaming path gates the submit on `finished.transcript.trim()`
// (app/app/scribe/page.tsx ~1926), so a note that reaches the result page has
// already proved its transcript non-empty. Every „Транскриптът е празен." a
// doctor has ever read was therefore false. The branch stays — it is the
// honest rendering IF that state is ever produced, and collapsing it into the
// unloaded state would be the same mistake in the other direction.
//
// ── WHAT THIS GATE IS ──────────────────────────────────────────────────────
// The decision is a pure function, so most of this is a real unit test rather
// than a text predicate. Section 5 keeps the SHIPPED collapse next to it and
// asserts it collapses — a suppression is only worth its red proof. Section 4
// is the overreach guard: this change silences a sentence, and suppressions
// overreach, so the fetched-and-empty report is pinned from both directions.
//
// Run: node --test scripts/transcript-panel.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const RESULT = read('app/app/scribe/result/page.tsx');

const { transcriptPanel, TRANSCRIPT_EMPTY, TRANSCRIPT_UNLOADED } =
  await import('../lib/transcript-state.ts');
const { resolveResultBootstrap } = await import('../lib/result-identity.ts');

const SPEECH = 'Пациентът съобщава кашлица от три дни.';

// ── 1. The three states ────────────────────────────────────────────────────

test('nothing fetched is not a verdict about the record', () => {
  const p = transcriptPanel(null);
  assert.equal(p.kind, 'unloaded');
  assert.equal(p.kind === 'unloaded' && p.notice, TRANSCRIPT_UNLOADED);
});

test('a blob that never carried the key is also „not fetched"', () => {
  // An older tuber_last_result shape, or any blob whose transcript key is
  // gone. `undefined` must not fall through to the empty REPORT.
  assert.equal(transcriptPanel(undefined).kind, 'unloaded');
});

test('fetched and genuinely empty still says so', () => {
  const p = transcriptPanel('');
  assert.equal(p.kind, 'empty');
  assert.equal(p.kind === 'empty' && p.notice, TRANSCRIPT_EMPTY);
  assert.equal(TRANSCRIPT_EMPTY, 'Транскриптът е празен.');
});

test('fetched whitespace is empty, not text', () => {
  // hasTranscript on the result page already trims, so a whitespace-only
  // transcript is „no transcript" everywhere else on the page. Rendering it as
  // TEXT would leave the panel saying nothing at all — the overreach this
  // change is most at risk of.
  for (const ws of ['   ', '\n', ' \t \n ']) {
    assert.equal(transcriptPanel(ws).kind, 'empty', JSON.stringify(ws));
  }
});

test('a real transcript is carried through verbatim', () => {
  const p = transcriptPanel(SPEECH);
  assert.equal(p.kind, 'text');
  assert.equal(p.kind === 'text' && p.text, SPEECH);
});

test('the two notices are different sentences, and only one is a verdict', () => {
  assert.notEqual(TRANSCRIPT_EMPTY, TRANSCRIPT_UNLOADED);
  // The unloaded state may not describe the record at all — no „празен", no
  // „няма", nothing a doctor can read as „the recording was lost".
  assert.ok(!/празен|празна|няма|липсва|загуб/i.test(TRANSCRIPT_UNLOADED),
    `the unloaded notice must not carry a verdict: ${TRANSCRIPT_UNLOADED}`);
});

// ── 2. The absence survives the blob ───────────────────────────────────────

const blobOf = (o: Record<string, unknown>) => JSON.stringify(o);
const FIELDS = { anamneza: 'Тест' };

test('a blob with no transcript key resolves to null, not to empty', () => {
  const d = resolveResultBootstrap(blobOf({ consultationId: 'c1', fields: FIELDS }), null, 'c1');
  assert.equal(d.mode, 'paint');
  assert.equal(d.mode === 'paint' && d.result.transcript, null);
});

test('a blob with a non-string transcript resolves to null', () => {
  for (const junk of [0, false, {}, []]) {
    const d = resolveResultBootstrap(
      blobOf({ consultationId: 'c1', transcript: junk, fields: FIELDS }), null, 'c1');
    assert.equal(d.mode === 'paint' && d.result.transcript, null, JSON.stringify(junk));
  }
});

test('a blob that really carries an empty transcript keeps it empty', () => {
  // The two states must survive the round trip through sessionStorage in BOTH
  // directions — normalising '' up to null would re-collapse them.
  const d = resolveResultBootstrap(
    blobOf({ consultationId: 'c1', transcript: '', fields: FIELDS }), null, 'c1');
  assert.equal(d.mode === 'paint' && d.result.transcript, '');
});

test('a blob with speech is untouched', () => {
  const d = resolveResultBootstrap(
    blobOf({ consultationId: 'c1', transcript: SPEECH, fields: FIELDS }), null, 'c1');
  assert.equal(d.mode === 'paint' && d.result.transcript, SPEECH);
});

// ── 3. The render bindings (source-text; section 5 proves them) ────────────

/** `src` with whole-line comments dropped. A gate that a COMMENT can trip is a
 *  gate that pressures the next reader into writing a worse comment — and the
 *  fix for this bug has to be able to quote the sentence it removed. Only full
 *  comment lines go; a rendered string never lives on one, and nothing inside a
 *  string literal is touched (so a `//` in a URL cannot hide a real hit). */
const code = (src: string): string =>
  src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');

const P = {
  /** The recovery path must record the ABSENCE, not an empty string. */
  recoveryRecordsAbsence(src: string): boolean {
    if (/transcript:\s*''/.test(code(src))) return false;
    return /transcript:\s*null/.test(code(src));
  },
  /** One decider. The two sentences may not be written into the page. */
  panelDelegatesTheDecision(src: string): boolean {
    const c = code(src);
    if (c.includes('Транскриптът е празен.')) return false;
    if (c.includes('Транскриптът не се зарежда')) return false;
    return /transcriptPanel\(/.test(c);
  },
  /** The source-label suppression is NOT part of this change: hasTranscript
   *  keeps reading the transcript itself, unchanged. */
  sourceSuppressionUntouched(src: string): boolean {
    return src.includes(
      "const hasTranscript = !!(original.transcript && original.transcript.trim());");
  },
};

test('the recovery path records that nothing was fetched', () => {
  assert.ok(P.recoveryRecordsAbsence(RESULT));
});

test('the panel delegates the three-state decision to one module', () => {
  assert.ok(P.panelDelegatesTheDecision(RESULT));
});

test('the source-label suppression is untouched by this change', () => {
  assert.ok(P.sourceSuppressionUntouched(RESULT));
});

// ── 4. Overreach guard — the empty REPORT must survive ─────────────────────
// A suppression's failure mode is silence where a true statement was owed.
// Pin the whole table, both directions, so „it now says nothing" cannot pass.

test('every input lands in exactly one state, and the states do not swap', () => {
  const table: [string | null | undefined, 'text' | 'empty' | 'unloaded'][] = [
    [null,        'unloaded'],
    [undefined,   'unloaded'],
    ['',          'empty'],
    ['   ',       'empty'],
    [SPEECH,      'text'],
    ['.',         'text'],
  ];
  for (const [input, kind] of table) {
    assert.equal(transcriptPanel(input).kind, kind, JSON.stringify(input));
  }
  // and the notices never cross over
  const empty = transcriptPanel('');
  const unloaded = transcriptPanel(null);
  assert.equal(empty.kind === 'empty' && empty.notice, TRANSCRIPT_EMPTY);
  assert.notEqual(empty.kind === 'empty' && empty.notice, TRANSCRIPT_UNLOADED);
  assert.notEqual(unloaded.kind === 'unloaded' && unloaded.notice, TRANSCRIPT_EMPTY);
});

test('the empty report is never rendered as silence', () => {
  const p = transcriptPanel('');
  if (p.kind === 'text') {
    assert.fail('a fetched, genuinely empty transcript must still be reported');
  }
  assert.ok(p.notice.length > 0);
});

// ── 5. Red proof ───────────────────────────────────────────────────────────

/** The decision as it shipped on 5cb9cff: one falsy test, both states one
 *  sentence. Kept here so the distinction has something to be distinct from. */
function shipped(transcript: string): string | null {
  if (!transcript) return 'Транскриптът е празен.';
  return null;
}

test('RED: the shipped decision collapses „not fetched" into „empty"', () => {
  // The recovery path handed it '' and it answered with the verdict.
  assert.equal(shipped(''), TRANSCRIPT_EMPTY);
  // The fix must NOT agree with it on that input.
  const p = transcriptPanel(null);
  assert.equal(p.kind, 'unloaded');
  assert.notEqual(p.kind === 'unloaded' ? p.notice : null, shipped(''));
});

test('RED: the shipped decision says nothing about a whitespace transcript', () => {
  assert.equal(shipped('   '), null);
  assert.equal(transcriptPanel('   ').kind, 'empty');
});

/** The page as it shipped: `transcript: ''` on the recovery path and the
 *  sentence written inline in TranscriptBody. */
const SHIPPED_PAGE = `
      setOriginal({
        consultationId: recovery.pendingVisit.consultation_id,
        transcript: '',
        fields: note,
      });
  const hasTranscript = !!(original.transcript && original.transcript.trim());
  if (!transcript) {
    return (
      <em style={{ color: 'var(--color-text-muted)' }}>Транскриптът е празен.</em>
    );
  }
`;

test('RED: the shipped page fails the absence predicate', () => {
  assert.equal(P.recoveryRecordsAbsence(SHIPPED_PAGE), false);
});

test('RED: the shipped page fails the single-decider predicate', () => {
  assert.equal(P.panelDelegatesTheDecision(SHIPPED_PAGE), false);
});

test('RED: writing the unloaded sentence inline also fails it', () => {
  const inlined = `
  if (transcript === null) return <em>Транскриптът не се зарежда при повторно отваряне.</em>;
  const p = transcriptPanel(transcript);
`;
  assert.equal(P.panelDelegatesTheDecision(inlined), false);
});

test('RED: the comment stripper hides comments, never rendered copy', () => {
  // The predicate must still catch the sentence when it is RENDERED …
  assert.equal(
    P.panelDelegatesTheDecision(
      "  const panel = transcriptPanel(t);\n      <em>Транскриптът е празен.</em>"),
    false);
  assert.equal(
    P.panelDelegatesTheDecision(
      "  const panel = transcriptPanel(t);\n  const s = 'Транскриптът е празен.';"),
    false);
  // … and must not be tripped by prose that quotes it, which is how the fix
  // explains itself.
  assert.equal(
    P.panelDelegatesTheDecision(
      "  // the panel published „Транскриптът е празен.\" over nothing\n  const panel = transcriptPanel(t);"),
    true);
  // A `//` inside a string may not swallow the rest of the file.
  assert.ok(code("const u = 'https://x';\n<em>Транскриптът е празен.</em>")
    .includes('Транскриптът е празен.'));
});

test('RED: touching the source-label suppression fails its predicate', () => {
  // Widening `hasTranscript` would silence „виж източника" on a fresh note —
  // out of bounds for this change, and the kind of thing a suppression does
  // to its neighbours.
  const widened = 'const hasTranscript = !!(original.transcript !== null);';
  assert.equal(P.sourceSuppressionUntouched(widened), false);
});
