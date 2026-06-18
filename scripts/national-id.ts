// P1-02 — per-ID-type validity for the new-visit stale-loaded-patient drop.
//
// When the doctor edits a loaded patient's national_id to a value that is no
// longer valid FOR ITS TYPE, the loaded patient must be dropped — otherwise the
// banner + DOB/age persist next to a mismatched ID and a save files the visit
// onto the wrong patient (a never-event). The drop predicate was egn-only; this
// generalizes it to all types, mirroring the backend's per-type rules exactly
// (same parity discipline as lib/egn.ts ↔ lib/national-id.js and the mkb gate).
//
// Backend source of truth (tubermed-backend/lib/national-id.js + routes/patients.js):
//   egn     → validateEgnFormat (10 digits) [+ plausible-age hard 400]; the strict
//             CLIENT gate (EgnField green-✓ / auto-load) also requires a derivable
//             DOB + correct mod-11 checksum — mirrored here so the drop fires in
//             lockstep with the ✓ disappearing.
//   lnch    → validateLnchFormat = /^\d{10}$/ (10 digits; no checksum/DOB).
//   foreign → no format validator; only the generic non-empty requirement.
//   none    → no ID; never drops on this basis.
//
// Pure, offline. Run: npx tsx scripts/national-id.ts (exit 0/1).

import { isValidIdForType, shouldDropLoadedPatient, idLast4 } from '../lib/national-id';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ ${msg}`); failed++; }
}

const VALID_EGN = '7501020018';   // format + DOB 1975-01-02 + correct checksum
const BAD_CHECKSUM_EGN = '7501020019'; // valid format + DOB, wrong 10th digit
const VALID_LNCH = '1000000009';  // 10 digits, no checksum
const VALID_FOREIGN = 'AB1234567';

// ── egn: mirrors the strict client gate (format + DOB + checksum) ────────────
console.log('\nTest 1: egn validity (format + derivable DOB + checksum)');
{
  assert(isValidIdForType('egn', VALID_EGN) === true, 'valid ЕГН → valid');
  assert(isValidIdForType('egn', BAD_CHECKSUM_EGN) === false, 'bad checksum ЕГН → invalid');
  assert(isValidIdForType('egn', '750102001') === false, '9-digit ЕГН → invalid (format)');
  assert(isValidIdForType('egn', '7513020010') === false, 'impossible month (no DOB) → invalid');
  assert(isValidIdForType('egn', '') === false, 'empty ЕГН → invalid');
}

// ── lnch: exactly 10 digits ──────────────────────────────────────────────────
console.log('\nTest 2: lnch validity (10 digits)');
{
  assert(isValidIdForType('lnch', VALID_LNCH) === true, '10-digit ЛНЧ → valid');
  assert(isValidIdForType('lnch', '123456789') === false, '9-digit ЛНЧ → invalid');
  assert(isValidIdForType('lnch', '12345678901') === false, '11-digit ЛНЧ → invalid');
  assert(isValidIdForType('lnch', 'ABCD123456') === false, 'non-digit ЛНЧ → invalid');
  assert(isValidIdForType('lnch', '') === false, 'empty ЛНЧ → invalid');
}

// ── foreign: non-empty (backend imposes no format) ───────────────────────────
console.log('\nTest 3: foreign validity (non-empty)');
{
  assert(isValidIdForType('foreign', VALID_FOREIGN) === true, 'non-empty foreign doc → valid');
  assert(isValidIdForType('foreign', 'X') === true, 'single-char foreign doc → valid (backend non-empty only)');
  assert(isValidIdForType('foreign', '') === false, 'empty foreign doc → invalid');
}

// ── none: no ID ──────────────────────────────────────────────────────────────
console.log('\nTest 4: none type');
{
  assert(isValidIdForType('none', '') === true, 'none + empty → valid (no ID required)');
  assert(isValidIdForType('none', 'anything') === true, 'none + text → valid (ID ignored)');
}

// ── shouldDropLoadedPatient = the exact drop predicate ───────────────────────
console.log('\nTest 5: shouldDropLoadedPatient (drop ⇔ invalid-for-type, never for none)');
{
  // egn — preserves today's behavior exactly
  assert(shouldDropLoadedPatient('egn', VALID_EGN) === false, 'valid ЕГН → keep');
  assert(shouldDropLoadedPatient('egn', BAD_CHECKSUM_EGN) === true, 'bad-checksum ЕГН → DROP');
  assert(shouldDropLoadedPatient('egn', '75010200') === true, 'short ЕГН → DROP');
  // lnch — the P1-02 fix
  assert(shouldDropLoadedPatient('lnch', VALID_LNCH) === false, 'valid ЛНЧ → keep');
  assert(shouldDropLoadedPatient('lnch', '12345') === true, 'short ЛНЧ → DROP (was the bug — never dropped before)');
  // foreign — the P1-02 fix
  assert(shouldDropLoadedPatient('foreign', VALID_FOREIGN) === false, 'valid foreign → keep');
  assert(shouldDropLoadedPatient('foreign', '') === true, 'cleared foreign → DROP');
  // none — never drops on ID basis
  assert(shouldDropLoadedPatient('none', '') === false, 'none → never drops');
  assert(shouldDropLoadedPatient('none', 'x') === false, 'none + text → never drops');
}

// ── idLast4: mirrors backend last4 (last 4 chars; null if < 4) ────────────────
console.log('\nTest 6: idLast4 mirrors backend last4 (save-time mismatch guard)');
{
  assert(idLast4('7501020018') === '0018', '10-digit → last 4 digits');
  assert(idLast4('AB1234567') === '4567', 'foreign → last 4 chars');
  assert(idLast4('12') === null, '< 4 chars → null');
  assert(idLast4('') === null, 'empty → null');
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
