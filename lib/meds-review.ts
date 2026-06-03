// Client-side mirror of the backend medication-completeness gate
// (tubermed-backend/lib/process-audio.js → validateMedicationCompleteness +
// routes/consultations.js → medsReviewBlock). Pure, deterministic, NO API —
// gives the result page instant fill/dismiss feedback; the server re-validates
// on /edit and 409s on /approve+/export as the final authority.
//
// The five clinically-essential components the doctor must FILL or consciously
// DISMISS before approval. `route` (начин на приложение) is the sixth, optional
// field — NOT required. Keep this list (and its ORDER) byte-identical to the
// backend MED_REQUIRED_COMPONENTS.

import type { Medication, MedsReview } from './types';

export const MED_REQUIRED_COMPONENTS = ['inn', 'form', 'dose', 'regimen', 'duration'] as const;
export type MedComponent = (typeof MED_REQUIRED_COMPONENTS)[number];

// Bulgarian labels for each required component (used by the meds UI + messages).
export const MED_COMPONENT_LABELS: Record<MedComponent, string> = {
  inn: 'Лекарство',
  form: 'Форма',
  dose: 'Доза',
  regimen: 'Прием',
  duration: 'Продължителност',
};

// A component counts as PRESENT only when it is a non-empty, non-whitespace
// string. Empty / whitespace / undefined → missing.
export function medComponentFilled(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

// computeMedsReview — for each medication compute which required components are
// empty (`missing`). A note needs review when ANY med has a missing required
// component. Mirrors validateMedicationCompleteness: FILL-REQUIRED — there is no
// dismiss escape, the only way to resolve a component is to fill it. Pure; never
// mutates the medications or writes a value.
export function computeMedsReview(meds: Medication[]): MedsReview {
  let needsReview = false;
  const reviewMeds = meds.map((med) => {
    const missing = MED_REQUIRED_COMPONENTS.filter(
      (c) => !medComponentFilled(med?.[c] as string | undefined),
    ) as string[];
    if (missing.length > 0) needsReview = true;
    return { missing };
  });
  return { needs_review: needsReview, meds: reviewMeds };
}

// Localized block message — mirrors the backend medsReviewBlock() copy so the
// approve-popup hint, the toast, and the 409 backstop read identically.
export function medsBlockMessage(): string {
  return 'Има предписани медикаменти с непопълнени данни (форма, доза, честота или продължителност). Попълнете липсващото преди потвърждаване.';
}
