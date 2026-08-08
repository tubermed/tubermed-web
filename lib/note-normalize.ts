// ─────────────────────────────────────────────────────────────────────────────
// note-normalize.ts — the READ boundary for a note that arrives from anywhere
// ─────────────────────────────────────────────────────────────────────────────
// ⚠ CROSS-REPO MIRROR: tubermed-backend/lib/note-shape.js (`coerceNoteShape`).
// The backend now types every field before it writes, so a note extracted after
// 2026-08-08 is already well-formed. This file exists for the ones that are not:
// the rows already in the database, written before that boundary existed.
//
// WHY THE READER CANNOT JUST TRUST THE WRITER. `izsledvania: []` is on 9 live
// rows, the oldest from 2026-05-18. Four of them are approved or sealed, and a
// sealed note can never be rewritten — /edit answers 409 `note_sealed`, with no
// unlock, by design. There is no migration that can reach those rows without
// breaking the seal, so the only place they can be made readable is here.
//
// WHY THE `|| ''` IDIOM DID NOT ALREADY DO THIS. It is the idiom this codebase
// reaches for everywhere — `(f.pridruzhavashti || []).map(…)`, `(s || '').trim()`
// — and it rescues exactly one case: null/undefined. `[] || ''` evaluates to
// `[]`, `'x' || []` evaluates to `'x'`. A truthy value of the wrong type passes
// straight through the fallback and reaches the method call that does not exist
// on it. That is why guarding at the crash site keeps not working: the guard
// looks present, reads as defensive, and is inert against the only input that
// can actually get there.
// ─────────────────────────────────────────────────────────────────────────────

import type { TranscribeFields, NoteShapeRepair } from './types';

/** What we had to do to a field to make it renderable. Content-free except for
 *  `text`, which carries clinical content and must never be logged or sent to
 *  telemetry — it is for the doctor's eyes, on screen. Shares its shape with
 *  the backend-written `fields.shape_repairs` so both render the same way. */
export type ShapeRepair = NoteShapeRepair;

const STRING_FIELDS = [
  'anamneza', 'obektivno', 'izsledvania', 'terapia', 'napravlenia', 'naznacheni',
  'osnovna_diagnoza', 'osnovna_mkb', 'osnovna_mkb_term', 'osnovna_mkb_term_source', '_disclaimer',
] as const;

// Element kind decides whether a bare string can be recovered into the array or
// must be quarantined. A string array takes the string; a row array cannot,
// because choosing which column the prose belongs to would be inventing data.
const ARRAY_FIELDS: Record<string, 'string' | 'object'> = {
  alergii: 'string',
  medications_list: 'object',
  pridruzhavashti: 'object',
  izsledvania_blocks: 'object',
  uncertain_spans: 'object',
  med_alerts: 'object',
  field_notices: 'object',
  field_completeness: 'object',
  shape_repairs: 'object',
};

function kindOf(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  return Array.isArray(v) ? 'array' : typeof v;
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v) ?? ''; } catch { return ''; }
}

/** Text carried by a value of any shape — so „we could not read it" can still
 *  hand the doctor back what arrived. */
function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v
      .map((el) => (typeof el === 'string' ? el : safeJson(el)))
      .filter((s) => s && s.trim())
      .join('\n');
  }
  if (v && typeof v === 'object') return safeJson(v);
  return '';
}

/** Any value → a string, never throwing. Use at any read site that calls a
 *  string method on a note field. */
export function asText(v: unknown): string {
  return typeof v === 'string' ? v : textOf(v);
}

/** Any value → an array, never throwing. A bare object becomes a single-element
 *  list (an unwrapped row); a string does NOT, because a row minted from prose
 *  is fabricated data. */
export function asList<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object') return [v as T];
  return [];
}

/**
 * Coerce a note to the declared field types. Never throws, never drops clinical
 * content: text that cannot be recovered into the declared type is returned in
 * `repairs[].text` for the caller to show.
 *
 * Absent keys stay absent — `izsledvania_blocks` uses ABSENT (never `[]`) as its
 * no-blocks sentinel, an echo лист carries none of the консултация keys, and
 * absence is the one case the readers' `|| ''` idiom genuinely does handle.
 */
export function normalizeNoteFields(
  input: TranscribeFields | null | undefined
): { fields: TranscribeFields; repairs: ShapeRepair[] } {
  const repairs: ShapeRepair[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { fields: {} as TranscribeFields, repairs };
  }

  // Written through an index-signature view on purpose. The declared types are
  // what we are REPAIRING — `osnovna_mkb_term_source` is `'exact' | 'parent'`,
  // and a note that reached us with a wrong type for it is precisely the input
  // the declared type was wrong about. Narrowing here would only re-assert the
  // assumption that failed; the check that matters is the runtime one below.
  const out = { ...input } as TranscribeFields;
  const bag = out as unknown as Record<string, unknown>;

  for (const field of STRING_FIELDS) {
    if (!(field in bag)) continue;
    const v = bag[field];
    if (typeof v === 'string') continue;
    const got = kindOf(v);
    const text = textOf(v);
    bag[field] = text;
    repairs.push({ field, got, recovery: text.trim() ? 'joined' : 'emptied' });
  }

  for (const [field, elementKind] of Object.entries(ARRAY_FIELDS)) {
    if (!(field in bag)) continue;
    const v = bag[field];
    if (Array.isArray(v)) continue;
    const got = kindOf(v);

    if (v && typeof v === 'object') {
      bag[field] = [v];
      repairs.push({ field, got, recovery: 'wrapped' });
      continue;
    }
    const text = textOf(v);
    if (elementKind === 'string' && text.trim()) {
      bag[field] = [text];
      repairs.push({ field, got, recovery: 'wrapped' });
      continue;
    }
    bag[field] = [];
    repairs.push(
      text.trim()
        ? { field, got, recovery: 'quarantined', text }
        : { field, got, recovery: 'emptied' }
    );
  }

  return { fields: out as TranscribeFields, repairs };
}

/** Repairs worth showing the doctor: the ones where content could not be put
 *  back where it belongs. A `[]` → `''` fix loses nothing, and a note that
 *  flags itself for nothing teaches the doctor to ignore the flag. */
export function lossyRepairs(repairs: ShapeRepair[]): ShapeRepair[] {
  return repairs.filter((r) => r.recovery === 'quarantined' && !!r.text);
}
