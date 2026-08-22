import type { MkbReview, MkbCorrection } from './types';

// Single source of truth for the МКБ reconcile gate's reason→copy mapping.
// The result page's approve toast, the 409 backstop, and the DiagnosesSection
// inline banner all read from here so the three can never drift apart. Pure —
// no React — so scripts/mkb-review-message.ts asserts it directly.
//
// The block DECISION stays in the page (keyed on needs_review === true); this
// only owns the WORDS.
export interface MkbReviewCopy {
  bannerTitle: string; // short ⚠ headline in the inline banner
  bannerDetail: string; // banner body
  blockMessage: string; // approve-toast / 409-backstop sentence (mirrors the backend)
}

// `osnovnaMkb` is ONLY the display fallback for the invalid-code banner code
// (mirrors the existing `mkbReview?.code || osnovnaMkb`); pass it from the banner
// site. It is never needed for the toast/backstop message.
export function mkbReviewCopy(review?: MkbReview | null, osnovnaMkb?: string): MkbReviewCopy {
  if (review?.reason === 'missing_code') {
    return {
      bannerTitle: 'Липсва код по МКБ-10',
      bannerDetail:
        'Изберете диагноза от МКБ-10 (търсете или 🔍). Потвърждаването и експортът са блокирани, докато липсва код.',
      blockMessage:
        'Липсва код по МКБ-10 за основната диагноза. Добавете валиден код преди потвърждаване.',
    };
  }

  if (review?.reason === 'diagnosis_text_not_grounded') {
    // P0-01: the code IS valid; the MAIN diagnosis text isn't supported by the
    // transcript. Point the doctor at the diagnosis — do NOT call the code invalid
    // or tell them to fix it. blockMessage is byte-identical to the backend
    // mkbReviewBlock() copy so the toast and the 409 backstop read identically.
    return {
      bannerTitle: 'Диагнозата не е открита в разговора',
      bannerDetail:
        'Кодът е валиден, но основната диагноза не личи в казаното по време на прегледа. Проверете дали отразява обсъденото и я потвърдете или коригирайте. Потвърждаването и експортът са блокирани.',
      blockMessage:
        'Основната диагноза не е спомената в разговора. Прегледайте и потвърдете диагнозата преди потвърждаване.',
    };
  }

  // invalid_code — default (also the fallback for any unhandled reason).
  const blockCode = review?.code ? `„${review.code}“` : 'кодът';
  const bannerCode = review?.code || osnovnaMkb || '';
  return {
    bannerTitle: 'Невалиден код по МКБ-10',
    bannerDetail: `Кодът „${bannerCode}“ не е в МКБ-10 регистъра. Изберете валиден (търсете или 🔍). Потвърждаването и експортът са блокирани.`,
    blockMessage: `Кодът по МКБ-10 ${blockCode} не е валиден. Коригирайте основната диагноза преди потвърждаване.`,
  };
}

// ── mkb_correction → the one line a doctor reads ────────────────────────────
//
// A code that was silently changed is a claim nobody can audit later. The
// backend records `{ from, to?, rule }` whenever what it FILED differs from what
// the model EMITTED; this turns that record into the sentence shown beside the
// code, so the doctor can see that M17.11 became M17.1 — and why.
//
// THE LINE THIS MUST NOT CROSS. Every string below is a statement about the
// RECORD, never about the PATIENT — the same rule field_notices is built on. No
// severity, no risk colour, no recommendation, no ordering by importance. The
// wording is rendered from the closed `rule` enum here, so the backend cannot
// widen it and the model can never author a word of it.
//
// This is an AI-uncertainty surface, not a warning: render it with the gold
// pair (--color-gold[-soft]), never --color-warn. Three review systems, never
// conflate.
export function mkbCorrectionCopy(c?: MkbCorrection | null): string | null {
  if (!c || typeof c.from !== 'string' || !c.from.trim()) return null;

  switch (c.rule) {
    case 'icd10cm_truncated':
      // The model reached for the US Clinical Modification. Say what was heard
      // and what was filed — the doctor is the one who can tell whether the lost
      // specificity mattered.
      return c.to
        ? `Кодът е приведен от „${c.from}“ към „${c.to}“ — „${c.from}“ е от американската класификация ICD-10-CM и не съществува в българската МКБ-10.`
        : null;

    case 'us_only_mapped':
      return c.to
        ? `Кодът е приведен от „${c.from}“ към „${c.to}“ — международен еквивалент на американски код.`
        : null;

    case 'invalid_code_stripped':
      // No code was filed. Say so plainly rather than leaving a blank the doctor
      // has to notice on their own.
      return `Кодът „${c.from}“ не е в регистъра на МКБ-10 и не беше записан. Добавете код ръчно, ако е нужен.`;

    case 'obstetric_no_context':
      return c.to
        ? `Кодът е приведен от „${c.from}“ към „${c.to}“ — „${c.from}“ е от акушерската глава, а разговорът не споменава бременност.`
        : `Кодът „${c.from}“ е от акушерската глава, а разговорът не споменава бременност — не беше записан.`;

    default:
      // An unrecognised rule renders NOTHING rather than guessing. A newer
      // backend must never be able to put an unreviewed sentence on the note.
      return null;
  }
}

// ── divergence_advisory → the one line a doctor reads about a mismatched term ─
//
// The backend flags a filed МКБ-10 term that shares no content stem with the
// dictation (I24.9 „Остра исхемична болест на сърцето" on „стенокардия при
// усилие, съмнение за стабилна форма"). The clinical stake is acuity, and an
// acute code on an ambulatory list is what an auditor notices — so the doctor
// sees the mismatch while scanning the diagnosis, not after going looking
// (2026-08-22 ruling; until then the field was stored and never read).
//
// Same line as mkbCorrectionCopy: a statement about the RECORD. No severity,
// no „невалиден", no „блокиран" — that vocabulary belongs to the needs_review
// gate, which this never touches. Gold pair, never --color-warn.
//
// `filedTerm` is the term currently on the note. The advisory was written at
// extraction time; if the doctor has since repicked the code the advisory
// describes a term that is no longer there, and must not render.
function sameTerm(a: string, b: string): boolean {
  const n = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return n(a) === n(b);
}

export function mkbDivergenceCopy(review: MkbReview | null | undefined, filedTerm: string): string | null {
  const a = review?.divergence_advisory;
  if (!a || a.diverged !== true) return null;
  const term = typeof a.term === 'string' ? a.term.trim() : '';
  const said = typeof a.diagnoza === 'string' ? a.diagnoza.trim() : '';
  if (!term || !said) return null;
  // The backend blanks an undictated/incidental main diagnosis to a bracketed
  // marker („[диагноза не е продиктувана — добави ръчно]") and its divergence
  // check does not exclude it, so after a code pick /edit can echo an advisory
  // whose `diagnoza` IS the marker. Quoting that as „what the doctor said" is
  // a lie; the guard is the whole-string [...] SHAPE, not a mirrored string.
  if (said.startsWith('[') && said.endsWith(']')) return null;
  if (!sameTerm(term, filedTerm || '')) return null;
  // A statement about the record only — no instruction, because the same line
  // renders on a sealed лист where there is nothing left to act on.
  return `Записаният термин по МКБ-10 „${term}“ се разминава с продиктуваното „${said}“.`;
}
