// ── What the transcript panel may say ───────────────────────────────────────
// „Транскриптът е празен." is a report about the RECORD. On a reopened note
// nothing had been fetched to report on — GET /api/consultations/:id does not
// select `transcript` at all (backend routes/consultations.js, DETAIL_COLS),
// by design — so the client filled the hole with '' and the panel read that
// zero length as a fact about the consultation. A doctor reads „the transcript
// is empty" as „the recording was lost".
//
// Same principle as the source-label suppression (lib/field-sources.ts,
// „the three silences"): „we haven't loaded it" and „it is empty" are
// different statements, and on a reopened note only the first one is true. The
// code could not tell them apart, because BOTH were the empty string. So the
// absence is now representable — TranscribeResult.transcript is
// `string | null`, and `null` means „no transcript value was ever obtained".
//
// Three states, and this module is the only thing that decides which:
//
//   unloaded  null / undefined      nothing was fetched. Name the mechanism,
//                                   never the record. NOT a negative verdict.
//   empty     '' or whitespace      fetched, and really is empty. This one is
//                                   a true report and must still be made.
//   text      anything else         render it.
//
// ⚠ MEASURED (2026-08-27): „fetched and genuinely empty" has no producer in the
// product today — the async path throws `no_speech` on a transcript that trims
// to nothing (backend lib/process-audio.js) and the streaming path gates its
// submit on `finished.transcript.trim()`. Every „Транскриптът е празен." a
// doctor has ever read was therefore false. The state stays anyway: it is the
// honest rendering if it is ever produced, and folding it into `unloaded`
// would be the same collapse in the other direction.
//
// Copy lives here rather than in the page for the same reason mkbReviewCopy
// does (lib/mkb-review.ts): one surface, one sentence, no drift.

/** Fetched, and really is empty. A true report — keep making it. */
export const TRANSCRIPT_EMPTY = 'Транскриптът е празен.';

/**
 * Nothing was fetched. States OUR state and nothing else.
 *
 * ⚠ It deliberately does NOT name the mechanism. The first draft read „не се
 * зарежда при повторно отваряне на бележката", which a refuter broke twice:
 *
 *   • „при повторно отваряне" is false on a FIRST open — a successful
 *     retry-extraction pushes straight to the result page with no blob
 *     (app/app/scribe/page.tsx, RecoveryPanel onSuccess), so the note lands on
 *     the recovery path having never been opened before.
 *   • naming the fetch implies there is something on the other end of it. For
 *     any row past TRANSCRIPT_RETENTION_DAYS (backend lib/transcript-sweeper.js,
 *     default 30) the transcript column has been NULLed while extracted_fields
 *     lives to CLINICAL_RETENTION_DAYS (default 90) — so a note between 30 and
 *     90 days old opens normally with its transcript permanently gone, and
 *     „we just haven't loaded it" is then its own kind of false comfort.
 *
 * The client cannot tell those rows apart: GET /:id returns no transcript and
 * no signal about whether one still exists. So this sentence claims neither.
 * ⚠ RULING OWED — see the note in the result page's transcript panel.
 */
export const TRANSCRIPT_UNLOADED = 'Транскриптът не е зареден.';

export type TranscriptPanel =
  | { kind: 'text'; text: string }
  | { kind: 'empty'; notice: string }
  | { kind: 'unloaded'; notice: string };

/**
 * Which of the three states a transcript value is in.
 *
 * `undefined` counts as unloaded, not empty: an older `tuber_last_result` blob
 * — or any blob whose key went missing — proves nothing about the recording
 * either, and falling through to the empty REPORT is exactly the bug.
 *
 * Whitespace counts as empty, not text. The result page's `hasTranscript`
 * already trims, so a whitespace-only transcript is „no transcript" everywhere
 * else on the page; rendering it as text would leave the panel saying nothing
 * at all, which is the way a suppression like this overreaches.
 */
export function transcriptPanel(transcript: string | null | undefined): TranscriptPanel {
  if (typeof transcript !== 'string') {
    return { kind: 'unloaded', notice: TRANSCRIPT_UNLOADED };
  }
  if (!transcript.trim()) {
    return { kind: 'empty', notice: TRANSCRIPT_EMPTY };
  }
  return { kind: 'text', text: transcript };
}
