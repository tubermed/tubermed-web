// Deterministic "what diagnosis term gets displayed / filed / exported".
//
// The code is the source of truth for the term: for a valid МКБ code the
// official nomenclature term (osnovna_mkb_term / comorbidity mkb_term, computed
// once by the backend validateMkbCodes via a LOCAL lookup — no API) wins. The
// doctor's spoken phrasing is only the fallback when there is no valid code, and
// is preserved immutably as the "доктор каза" cue source. Pure, no API.

import type { TranscribeFields, ComorbidDiagnosis } from './types';

export function filedMainTerm(f: TranscribeFields): string {
  const official = (f.osnovna_mkb_term || '').trim();
  return official || (f.osnovna_diagnoza || '').trim();
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
