// ── Clinical-alert switch (frontend mirror of lib/clinical-alerts.js) ───────
//
// WHY THIS EXISTS (2026-08-01, Dimitar's ruling). MDR qualification turns on
// INTENDED PURPOSE. Software that SELECTS a drug/allergy/diagnosis pair and
// surfaces it performs a clinical act, because the selection encodes
// pharmacology — rewording the sentence changes tone, not function. Under MDR
// Rule 11 / MDCG 2019-11 that risks qualifying as medical device software, which
// is unacceptable exposure before pilots. Removal is reversible; classification
// is not.
//
// WHY A SEPARATE FRONTEND FLAG AND NOT JUST THE BACKEND ONE. The browser has its
// OWN clinical rule engine — `lib/drug-safety.ts` `checkDrugSafety()`, 8 allergy
// rules and 4 interaction rules — and `mergeBackendAlerts()` calls it
// unconditionally. So an empty `med_alerts` from the backend does NOT produce an
// alert-free screen: the frontend engine would keep generating alerts from the
// extracted fields alone. Both engines have to be gated or neither is.
//
// FAIL-SAFE DIRECTION IS OFF, and deliberately so at BUILD time: this reads
// NEXT_PUBLIC_CLINICAL_ALERTS, which Next inlines at build. An unset or
// misspelled value yields a build with no clinical alert surface at all.
//
// Keep in sync with the backend module — both must be flipped together, and the
// backend one is authoritative for what is computed. This one only decides what
// is DISPLAYED (and whether the frontend engine runs at all).

const ON_VALUES = new Set(['1', 'true', 'on', 'yes']);

export function clinicalAlertsEnabled(): boolean {
  const raw = (process.env.NEXT_PUBLIC_CLINICAL_ALERTS ?? '').trim().toLowerCase();
  return ON_VALUES.has(raw);
}

/** Constant form for render-time branches — Next inlines the env at build. */
export const CLINICAL_ALERTS_ENABLED = clinicalAlertsEnabled();
