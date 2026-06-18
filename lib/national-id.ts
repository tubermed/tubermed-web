// P1-02 — client-side per-ID-type validity, mirroring the backend's authoritative
// rules (tubermed-backend/lib/national-id.js + routes/patients.js). Same
// cross-repo parity discipline as lib/egn.ts ↔ lib/national-id.js and the mkb
// gate: if this diverges from what the backend accepts, the new-visit drop
// predicate could keep a stale loaded patient the backend would reject (or drop
// one it would accept). Pure — no React, no network.

import { isValidEgnFormat, isValidEgnChecksum, dobFromEgn } from './egn';

export type NationalIdType = 'egn' | 'lnch' | 'foreign' | 'none';

// Is `id` a valid identity FOR `type`?
//   egn     → the strict CLIENT gate (EgnField green-✓ / auto-load): 10 digits +
//             a derivable DOB + a correct mod-11 checksum. (Backend's HARD gate is
//             format + plausible-age; checksum is soft there, but the client has
//             always treated a bad checksum as "not a valid identity" so the drop
//             fires in lockstep with the ✓ disappearing — keep that.)
//   lnch    → validateLnchFormat: exactly 10 digits.
//   foreign → backend imposes no format; only a non-empty value is required.
//   none    → no ID for this type → vacuously valid (never the basis for a drop).
export function isValidIdForType(type: string, id: string): boolean {
  const v = typeof id === 'string' ? id : '';
  switch (type) {
    case 'egn':
      return isValidEgnFormat(v) && dobFromEgn(v) !== null && isValidEgnChecksum(v);
    case 'lnch':
      return /^\d{10}$/.test(v);
    case 'foreign':
      return v.length > 0;
    case 'none':
      return true;
    default:
      return false;
  }
}

// The drop predicate: a LOADED patient is dropped when its ID field is edited to
// a value that is no longer valid for its type. 'none' never drops on this basis
// (it has no ID). Generalized from the former egn-only branch (P1-02).
export function shouldDropLoadedPatient(type: string, id: string): boolean {
  return type !== 'none' && !isValidIdForType(type, id);
}

// Last 4 chars of an ID (or null when < 4) — MIRROR of backend
// lib/national-id.js `last4`. Used by the save-time guard to confirm the form's
// ID still matches the loaded patient's national_id_last4 before PATCH/POST.
export function idLast4(id: string): string | null {
  const v = typeof id === 'string' ? id : '';
  return v.length >= 4 ? v.slice(-4) : null;
}
