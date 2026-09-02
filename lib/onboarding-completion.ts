// ── Onboarding completion — the write the wizard's whole promise rests on ────
//
// components/OnboardingWizard.tsx shows ONCE EVER, server-tracked: the
// new-visit page opens it only when GET /me returns
// onboarding_completed_at === null, and every path out of the wizard fires
// PATCH /me { onboarding_completed: true }. Until 2026-09-02 that PATCH was
// fire-and-forget with a swallowed catch — one failed write on clinic Wi-Fi
// and the doctor who just finished the wizard met it again on the next load,
// with no telemetry trace anywhere. This module is the reliability layer:
//
//   1. TRANSIENT failure never re-shows the wizard: the write is retried
//      (RETRY_DELAYS_MS), and a per-doctor localStorage marker — written
//      BEFORE the first attempt, cleared on confirmed success — suppresses the
//      re-show and re-fires the write on the next mount instead.
//   2. PERSISTENT failure becomes visible: after the last attempt a
//      numbers-only Sentry message is emitted (status + attempt count, nothing
//      else — the blanket PII rule; the message must match its full-string
//      pattern in public/sentry-scrub-contract.json or it arrives redacted).
//   3. The SERVER stays the source of truth. The marker is keyed by doctor id
//      and consulted only when /me still says null for THAT doctor, so it can
//      never hide the wizard from a genuinely new account; when /me says
//      completed, the marker is deleted. (QA note: resetting
//      onboarding_completed_at to NULL in the DB re-shows the wizard only on a
//      browser without the doctor's marker — on the marked browser the next
//      load quietly re-completes it. Clear the marker key too.)
//
// DOM-free on purpose (no imports from lib/api.ts, no Sentry import): the
// suite is `node --test scripts/*.test.ts`, and this logic is exactly what
// scripts/onboarding-completion.test.ts executes. The browser wiring lives in
// components/OnboardingWizard.tsx (onboardingCompletionDeps) and is pinned by
// source checks in the same test file.

export const RETRY_DELAYS_MS: readonly number[] = [2000, 8000];

const MARKER_PREFIX = 'tuber_onboarding_completed:';

/** The subset of Storage this module touches — every call is try/caught. */
export interface MarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CompletionDeps {
  /** Fires PATCH /me { onboarding_completed: true }. */
  updateMe: () => Promise<unknown>;
  /** Ships one numbers-only message to Sentry (see buildCompletionFailedMessage). */
  report: (message: string) => void;
  /** localStorage in the browser; null when unavailable (SSR, privacy mode). */
  storage: MarkerStorage | null;
  /** Injectable for tests; defaults to setTimeout. */
  delay?: (ms: number) => Promise<void>;
}

export function completionMarkerKey(doctorId: string): string {
  return MARKER_PREFIX + doctorId;
}

// An id-less doctor gets NO marker: a shared un-keyed marker would let one
// doctor's failed write hide the wizard from the next account on the machine.
function readMarker(doctorId: string, storage: MarkerStorage | null): boolean {
  if (!doctorId || !storage) return false;
  try {
    return storage.getItem(completionMarkerKey(doctorId)) !== null;
  } catch {
    return false;
  }
}

function writeMarker(doctorId: string, storage: MarkerStorage | null): void {
  if (!doctorId || !storage) return;
  try {
    storage.setItem(completionMarkerKey(doctorId), '1');
  } catch {
    /* storage refused — behaves as the pre-fix wizard did */
  }
}

export function clearCompletionMarker(doctorId: string, storage: MarkerStorage | null): void {
  if (!doctorId || !storage) return;
  try {
    storage.removeItem(completionMarkerKey(doctorId));
  } catch {
    /* nothing to clean */
  }
}

/** status 0 = no HTTP answer at all (offline, DNS, abort) — same normalisation
 *  as lib/pilot-lead-alert.ts, read structurally so this module never imports
 *  ApiError. */
export function normaliseWriteStatus(err: unknown): number {
  const s = err && typeof err === 'object' ? (err as { status?: unknown }).status : undefined;
  return typeof s === 'number' && Number.isInteger(s) && s >= 100 && s <= 599 ? s : 0;
}

/**
 * The exact string sent to Sentry. NUMBERS ONLY, by construction: whatever the
 * inputs, the output matches the contract pattern
 *   ^\[onboarding\] completion write failed: status=\d{1,3} attempts=\d{1,2}$
 * or the scrub redacts the alert into noise.
 */
export function buildCompletionFailedMessage(status: unknown, attempts: unknown): string {
  const s = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : 0;
  const a = typeof attempts === 'number' && Number.isInteger(attempts) && attempts >= 1 && attempts <= 99
    ? attempts
    : 1;
  return `[onboarding] completion write failed: status=${s} attempts=${a}`;
}

/**
 * Mark onboarding complete: marker first (so a remount during the retry window
 * already suppresses the re-show), then the write with bounded retries. Never
 * throws, never blocks the caller — the wizard closes immediately regardless.
 */
export async function markOnboardingComplete(
  doctorId: string,
  deps: CompletionDeps,
): Promise<{ ok: boolean; attempts: number }> {
  const delay = deps.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  writeMarker(doctorId, deps.storage);
  let lastStatus = 0;
  const total = RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= total; attempt++) {
    try {
      await deps.updateMe();
      clearCompletionMarker(doctorId, deps.storage);
      return { ok: true, attempts: attempt };
    } catch (err) {
      lastStatus = normaliseWriteStatus(err);
      if (attempt < total) await delay(RETRY_DELAYS_MS[attempt - 1]);
    }
  }
  // Persistent failure: the marker stays (the next mount suppresses the
  // re-show and re-fires this function), and the silence ends here.
  deps.report(buildCompletionFailedMessage(lastStatus, total));
  return { ok: false, attempts: total };
}

/**
 * The render decision the new-visit page makes on mount, given a fresh /me.
 *
 *   completed_at ABSENT   → unknown (backend pre-015): show nothing, touch
 *                           nothing — zero behaviour change on that path.
 *   completed_at non-null → no wizard; delete any leftover marker (the server
 *                           has confirmed, the hint is spent).
 *   completed_at null     → wizard, UNLESS this doctor's marker says they
 *                           already completed it here and the write is what
 *                           failed — then suppress and re-fire the write.
 */
export function resolveOnboardingOnLoad(
  me: { id: string; onboarding_completed_at?: string | null },
  deps: CompletionDeps,
): { showWizard: boolean } {
  if (me.onboarding_completed_at === undefined) return { showWizard: false };
  if (me.onboarding_completed_at !== null) {
    clearCompletionMarker(me.id, deps.storage);
    return { showWizard: false };
  }
  if (readMarker(me.id, deps.storage)) {
    void markOnboardingComplete(me.id, deps);
    return { showWizard: false };
  }
  return { showWizard: true };
}
