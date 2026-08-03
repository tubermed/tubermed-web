// Document-state notices — the frontend mirror of backend lib/field-notices.js.
//
// ⚠ CROSS-REPO MIRROR INVARIANT: the enum and NOTICE_LABELS below are the
// committed display mirror of the backend's frozen table. A change to either
// must land in BOTH repos together — same discipline as the investigation
// templates and public/ial-inns.json / mkb10.json. Vercel never sees the
// backend repo at runtime.
//
// ── THE LINE ────────────────────────────────────────────────────────────────
// A notice states a fact about the DOCUMENT, never about the PATIENT.
// „Пеницилин — записан без опора в транскрипта" is document state. Anything
// resembling „вероятно не е алергичен" is a clinical claim, and there is
// deliberately no channel to express one: an entry carries a closed-enum code
// and an index, and the Bulgarian is rendered from the frozen table here.
// Clinical alerts are OFF (2026-08-01 ruling) — this is not a way back in.
//
// ── WHAT THIS MODULE MAY DO ─────────────────────────────────────────────────
//   RENDER      — noticeLabel(), from the frozen table + our own extracted text.
//   RE-ANCHOR   — reanchorFieldNotices(), the same pure index-following logic
//                 the server runs on /edit, so a local delete/reorder can never
//                 render a notice against the wrong allergen while the
//                 round-trip is in flight. Needs no transcript.
//
// ── WHAT IT MUST NOT DO ─────────────────────────────────────────────────────
//   DERIVE      — never. Deriving needs the transcript and is the server's job.
//                 A browser that could mint a notice would be a second,
//                 unguarded writer into a surface whose entire containment
//                 argument is that exactly one place can write it.
//   PERSIST ACK — never. Acknowledgement belongs in the client store. `fields`
//                 is what /edit persists; an ack written there becomes part of
//                 the medical record. reanchorFieldNotices RETURNS an array and
//                 never writes into the note it is given.

import type { TranscribeFields, FieldNotice, FieldNoticeCode } from './types';

export const NOTICE_CODES: readonly FieldNoticeCode[] = Object.freeze(['allergen_no_anchor']);

// The ONLY doctor-facing text this feature can produce. Word-identical to the
// backend's NOTICE_LABELS — pinned by scripts/field-notices.test.ts.
export const NOTICE_LABELS: Readonly<Record<FieldNoticeCode, string>> = Object.freeze({
  allergen_no_anchor: 'записан без опора в транскрипта',
});

function isKnownCode(c: unknown): c is FieldNoticeCode {
  return typeof c === 'string' && (NOTICE_CODES as readonly string[]).includes(c);
}

/**
 * The Bulgarian line for one notice. Returns null — renders nothing — when the
 * code is unknown or the referenced row no longer exists, so an out-of-date
 * notice can never name the wrong allergen.
 */
export function noticeLabel(entry: FieldNotice, fields: TranscribeFields): string | null {
  if (!entry || !isKnownCode(entry.code)) return null;
  const what = NOTICE_LABELS[entry.code];
  if (!what) return null;
  const arr = entry.ref && entry.ref.field === 'alergii' && Array.isArray(fields?.alergii)
    ? fields.alergii
    : [];
  const subject = typeof arr[entry.ref?.index] === 'string' ? arr[entry.ref.index].trim() : '';
  if (!subject) return null;
  return `${subject} — ${what}.`;
}

const norm = (s: unknown): string => (typeof s === 'string' ? s.trim().toLowerCase() : '');

/**
 * Re-point each surviving notice at wherever its allergen TEXT now sits.
 * A row that was deleted or corrected has no surviving notice — fixing the
 * field clears it. Pure: returns a new array, mutates nothing.
 */
export function reanchorFieldNotices(
  prevFields: TranscribeFields,
  nextFields: TranscribeFields,
): FieldNotice[] {
  const prior = Array.isArray(prevFields?.field_notices) ? prevFields.field_notices : [];
  const prevAlergii = Array.isArray(prevFields?.alergii) ? prevFields.alergii : [];
  const nextAlergii = Array.isArray(nextFields?.alergii) ? nextFields.alergii : [];

  const kept: FieldNotice[] = [];
  const seen = new Set<string>();

  for (const n of prior) {
    if (!n || typeof n !== 'object' || !isKnownCode(n.code)) continue;
    if (!n.ref || n.ref.field !== 'alergii') continue;

    const text = norm(prevAlergii[n.ref.index]);
    if (!text) continue;

    const index = nextAlergii.findIndex((a) => norm(a) === text);
    if (index === -1) continue;

    const key = `${n.code}:${index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ code: n.code, ref: { field: 'alergii', index } });
  }

  return kept;
}
