import type { MkbReview } from './types';

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
