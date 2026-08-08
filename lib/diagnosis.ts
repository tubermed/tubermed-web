// Deterministic "what diagnosis term gets displayed / filed / exported".
//
// The code is the source of truth for the term: for a valid МКБ code the
// official nomenclature term (osnovna_mkb_term / comorbidity mkb_term, computed
// once by the backend validateMkbCodes via a LOCAL lookup — no API) wins. The
// doctor's spoken phrasing is only the fallback when there is no valid code, and
// is preserved immutably as the "доктор каза" cue source. Pure, no API.

import type { TranscribeFields, ComorbidDiagnosis } from './types';
import { asText } from './note-normalize.ts';

export function filedMainTerm(f: TranscribeFields): string {
  const official = asText(f.osnovna_mkb_term).trim();
  return official || asText(f.osnovna_diagnoza).trim();
}

export function filedComorbidityTerm(d: ComorbidDiagnosis): string {
  const official = (d.mkb_term || '').trim();
  return official || (d.diagnoza || '').trim();
}

// Normalize for comparison: lowercase, strip brackets/punctuation, collapse
// whitespace. Used only to decide whether the spoken phrasing meaningfully
// diverges from the official term.
function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[[\]().,;:/"'`«»\-—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// "доктор каза" cue: true when the doctor's spoken phrasing meaningfully diverges
// from the official term. A benign rewording where one is contained in the other
// (e.g. spoken "първична хипертония" ⊂ official "Есенциална [първична]
// хипертония") is NOT a divergence; a genuine wrong-code mismatch (spoken
// "навехнат глезен" vs official "Контузия на глезена") IS. Deterministic, no API.
export function spokenDivergesFromOfficial(spoken?: string, official?: string): boolean {
  const a = norm(spoken || '');
  const b = norm(official || '');
  if (!a || !b) return false;            // nothing to compare → no cue
  if (a === b) return false;
  if (a.includes(b) || b.includes(a)) return false; // contained → benign rewording
  return true;
}

// ─── The filed diagnosis block (2026-08-03 ruling) ───────────────────────────
//
// One shape, one helper, four surfaces: screen, PDF, Word, clipboard. The
// амбулаторен лист is an НЗОК primary document — the term|code pair is what a
// reviewer anchors on, so that pair is what gets FILED, and a hedged dictation
// („най-вероятно вирусен фарингит, изчакваме посявката") is a sentence, not a
// term. The doctor's actual wording is never discarded: it rides on its own
// attributed line beneath.
//
// ── Why the attribution is UNCONDITIONAL ────────────────────────────────────
// The old screen cue was gated on `spokenDivergesFromOfficial` and vanished
// whenever the two strings coincided. An attribution that is present on some
// notes and absent on others teaches a reader to distrust its absence — they
// cannot tell „nothing was said differently" from „the tool didn't show me".
// So it is always present. `spokenDivergesFromOfficial` is KEPT (it still
// classifies a genuine wrong-code mismatch, and callers may style on it) but it
// gates nothing here.
//
// ── Why the no-code case is a STATE, not a coincidence ──────────────────────
// When no register term resolved, `term` falls back to the dictated wording and
// the two strings are identical BY CONSTRUCTION. Printing them twice reads as a
// bug, and a doctor who thinks the tool is glitching stops reading the
// attribution on every other note too. That case renders one line carrying an
// explicit no-code marker instead.
//
// ⚠ It is branched on the STRUCTURAL fact — no official term, so the term was
// sourced from the dictation — and NEVER by comparing the two strings. A note
// whose register term genuinely equals the dictation („Астма" / „Астма") is the
// ordinary attributed state, and must not silently lose its cue. That is what
// `scripts/diagnosis-presentation.test.ts` pins.

/** Where the FILED term came from. Structural — never inferred by comparison. */
export type FiledTermSource = 'official' | 'dictated';

/**
 * What the attribution line beneath the filed term is saying.
 *  - `dictated`          — an official term was filed; this is what the doctor said.
 *  - `no_dictation`      — an official term was filed; nothing was dictated to attribute.
 *  - `no_official_code`  — no register term resolved; the dictation is all there is.
 */
export type MainDiagnosisProvenance = 'dictated' | 'no_dictation' | 'no_official_code';

export const ATTRIBUTION_PREFIX = 'доктор каза: ';
export const NO_OFFICIAL_CODE_NOTE = 'без официален код по МКБ-10 — записано е продиктуваното';
export const NO_DICTATION_NOTE = 'без продиктувана формулировка — терминът е от МКБ-10';
export const PARENT_RUBRIC_NOTE = 'категория по МКБ-10 (3-знача рубрика)';

export interface MainDiagnosisPresentation {
  /** The term that gets filed: the official register term, or the dictation as fallback. */
  term: string;
  /** The МКБ code as filed. '' when none. */
  code: string;
  /** Which of the two the filed term came from. */
  termSource: FiledTermSource;
  /** The doctor's dictated wording, verbatim and untouched. '' when none. */
  spoken: string;
  /** Which line sits beneath the filed term. */
  provenance: MainDiagnosisProvenance;
  /** That line, rendered. '' only when there is no block at all. */
  attributionLine: string;
  /** True when the official term is the 3-character parent rubric, not an exact match. */
  parentRubric: boolean;
  /** The rubric caption. '' when not a parent-accepted code. */
  parentRubricLine: string;
  /** False when there is neither a term nor a code — nothing to render. */
  hasContent: boolean;
}

/**
 * @param f         the note as it stands — `osnovna_diagnoza` is the LIVE field,
 *                  so it is what gets filed when no register term resolved.
 * @param dictated  the immutable AI-original wording, when the caller holds the
 *                  snapshot (the result page does; the exporters do not). This
 *                  is what „доктор каза" quotes — attributing the doctor's own
 *                  later edit back to their dictation would be a small lie on a
 *                  legal document. Omitted/undefined → the live field, which is
 *                  the honest source when no snapshot exists.
 */
export function mainDiagnosisPresentation(
  f: TranscribeFields,
  dictated?: string,
): MainDiagnosisPresentation {
  const official = asText(f.osnovna_mkb_term).trim();
  const current = asText(f.osnovna_diagnoza).trim();
  const spoken = asText(dictated ?? f.osnovna_diagnoza).trim();
  const code = asText(f.osnovna_mkb).trim();

  // THE structural branch. `official` is the register lookup's own answer —
  // present or absent. Nothing here compares `official` to `spoken`.
  const termSource: FiledTermSource = official ? 'official' : 'dictated';
  const term = official || current;

  const provenance: MainDiagnosisProvenance =
    termSource === 'dictated' ? 'no_official_code' : spoken ? 'dictated' : 'no_dictation';

  const hasContent = !!(term || code);

  // A parent-accepted code prints its CATEGORY label — „Неинсулинозависим
  // захарен диабет" over a dictated „тип 2 с неврологични усложнения". Without
  // this line that reads as the лист contradicting the doctor's own words.
  const parentRubric = termSource === 'official' && f.osnovna_mkb_term_source === 'parent';

  let attributionLine = '';
  if (hasContent) {
    if (provenance === 'no_official_code') attributionLine = NO_OFFICIAL_CODE_NOTE;
    else if (provenance === 'no_dictation') attributionLine = NO_DICTATION_NOTE;
    else attributionLine = ATTRIBUTION_PREFIX + spoken;
  }

  return {
    term,
    code,
    termSource,
    spoken,
    provenance,
    attributionLine,
    parentRubric,
    parentRubricLine: parentRubric ? PARENT_RUBRIC_NOTE : '',
    hasContent,
  };
}