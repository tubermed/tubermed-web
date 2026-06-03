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
// empty (`missing`) and preserve the doctor's `dismissed` choices from a prior
// review (index-aligned). A note needs review when ANY med has a missing
// component that is NOT dismissed. Mirrors validateMedicationCompleteness:
//   • dismissed is intersected with missing — a dismissed component the doctor
//     later FILLS drops out naturally; re-emptying a value re-blocks it.
//   • NEVER mutates the medications or writes a value — `dismissed` records a
//     choice only (the doctor's "intentionally open").
export function computeMedsReview(
  meds: Medication[],
  prior?: MedsReview | null,
): MedsReview {
  const priorMeds = prior?.meds ?? [];
  let needsReview = false;
  const reviewMeds = meds.map((med, i) => {
    const missing = MED_REQUIRED_COMPONENTS.filter(
      (c) => !medComponentFilled(med?.[c] as string | undefined),
    ) as string[];
    const priorDismissed = Array.isArray(priorMeds[i]?.dismissed)
      ? priorMeds[i].dismissed
      : [];
    const dismissed = missing.filter((c) => priorDismissed.includes(c));
    if (missing.some((c) => !dismissed.includes(c))) needsReview = true;
    return { missing, dismissed };
  });
  return { needs_review: needsReview, meds: reviewMeds };
}

// Localized block message — mirrors the backend medsReviewBlock() copy so the
// approve-popup hint, the toast, and the 409 backstop read identically.
export function medsBlockMessage(): string {
  return 'Има предписани медикаменти с непопълнени данни (форма, доза, честота или продължителност). Попълнете липсващото или го отбележете съзнателно като пропуснато преди потвърждаване.';
}
