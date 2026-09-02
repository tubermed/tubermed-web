// ─────────────────────────────────────────────────────────────────────────────
// Onboarding completion — a failed write must not re-show the wizard
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm test   (node --test, Node 24 strips the types natively.)
//
// THE MECHANISM (verified 2026-09-02, and carried below as an executed repro):
// the new-visit page opens OnboardingWizard iff GET /me returns
// onboarding_completed_at === null, and finish() used to fire
// PATCH /me { onboarding_completed: true } once, fire-and-forget, catch
// swallowed. One failed write — flaky clinic Wi-Fi is enough — and the server
// still says null, so the doctor who just completed the wizard meets it again
// on the next load, and NOTHING records that it happened. The pre-fix
// behaviour is embedded verbatim below and shown to reproduce the re-show on
// every run, so this gate carries the defect it was written for.
//
// WHAT THE FIX MUST HOLD (the bar, each executed here):
//   1. a TRANSIENT write failure never re-shows the wizard (retry + per-doctor
//      marker written before the first attempt, re-fire on next mount);
//   2. a PERSISTENT failure emits a numbers-only Sentry message that survives
//      the REAL scrub (lib/sentry-scrub.ts) — an alert that arrives as
//      „[redacted…]" is an alarm that fires empty;
//   3. the marker is a HINT: keyed by doctor id, deleted once the server
//      confirms — it can never hide the wizard from a genuinely new account.
//
// The browser wiring (Sentry.captureMessage, localStorage, api.updateMe) lives
// in .tsx files node --test cannot import, so it is pinned by source checks at
// the bottom — branch-anchored, and red-proven against mutated copies on every
// run, the same shape as scripts/access-form-alert.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ErrorEvent } from '@sentry/nextjs';
import {
  RETRY_DELAYS_MS,
  buildCompletionFailedMessage,
  clearCompletionMarker,
  completionMarkerKey,
  markOnboardingComplete,
  normaliseWriteStatus,
  resolveOnboardingOnLoad,
  type CompletionDeps,
  type MarkerStorage,
} from '../lib/onboarding-completion.ts';
import { scrubEvent } from '../lib/sentry-scrub.ts';

const REPO = path.resolve(import.meta.dirname, '..');
const DOCTOR_A = '3f2b91c4-0e77-4a1d-9c55-8a0d61b2e4aa';
const DOCTOR_B = '9c55aa0d-61b2-4e4a-8a0d-3f2b91c40e77';

// ── Harness ──────────────────────────────────────────────────────────────────

function fakeStorage(): MarkerStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const throwingStorage: MarkerStorage = {
  getItem: () => { throw new Error('storage refused'); },
  setItem: () => { throw new Error('storage refused'); },
  removeItem: () => { throw new Error('storage refused'); },
};

/** updateMe that fails `failures` times (with `status`), then succeeds. */
function flakyUpdateMe(failures: number, status = 503) {
  let calls = 0;
  const fn = () => {
    calls++;
    return calls <= failures
      ? Promise.reject({ status })
      : Promise.resolve({});
  };
  return { fn, get calls() { return calls; } };
}

function deps(
  updateMe: () => Promise<unknown>,
  storage: MarkerStorage | null,
  reports: string[],
): CompletionDeps {
  return { updateMe, storage, report: (m) => void reports.push(m), delay: () => Promise.resolve() };
}

const TOTAL_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

// ── 0 · the pre-fix mechanism, reproduced on every run ───────────────────────
// The wizard and the page as they stood before this batch, in miniature and
// faithful to the defect: fire-and-forget with a swallowed catch, and a render
// decision that reads ONLY the server value. This arm must keep FAILING the
// bar — if it ever stops re-showing the wizard, this gate no longer knows what
// it is protecting against.

test('REPRO: one failed fire-and-forget write re-shows the wizard on the next mount', async () => {
  const legacyFinish = (updateMe: () => Promise<unknown>) => {
    updateMe().catch(() => { /* best-effort — the pre-fix header comment */ });
  };
  const legacyDecision = (me: { onboarding_completed_at?: string | null }) =>
    me.onboarding_completed_at === null;

  let serverCompleted = false;
  const failingUpdate = () => Promise.reject({ status: 0 }); // clinic Wi-Fi
  legacyFinish(failingUpdate);
  await Promise.resolve(); // let the swallowed rejection settle
  // Next load: the write never landed, so /me still says null…
  assert.equal(serverCompleted, false);
  assert.equal(
    legacyDecision({ onboarding_completed_at: null }),
    true,
    'the pre-fix mechanism stopped reproducing — this gate no longer carries its defect',
  );

  // …and the SAME sequence through the shipped module keeps the wizard closed.
  const storage = fakeStorage();
  const reports: string[] = [];
  await markOnboardingComplete(DOCTOR_A, deps(failingUpdate, storage, reports));
  const next = resolveOnboardingOnLoad(
    { id: DOCTOR_A, onboarding_completed_at: null },
    deps(() => { serverCompleted = true; return Promise.resolve({}); }, storage, reports),
  );
  assert.equal(next.showWizard, false, 'a completed doctor met the wizard again');
});

// ── 1 · transient failure ────────────────────────────────────────────────────

test('a transient failure is retried to success: no re-show, no marker left, no alert', async () => {
  const storage = fakeStorage();
  const reports: string[] = [];
  const flaky = flakyUpdateMe(1);
  const res = await markOnboardingComplete(DOCTOR_A, deps(flaky.fn, storage, reports));
  assert.deepEqual(res, { ok: true, attempts: 2 });
  assert.equal(flaky.calls, 2);
  assert.equal(storage.map.size, 0, 'the marker must be spent once the server confirmed');
  assert.deepEqual(reports, [], 'a recovered write must not alert');
});

test('the marker is written BEFORE the first attempt resolves — a remount inside the retry window is already covered', () => {
  const storage = fakeStorage();
  const reports: string[] = [];
  const never = () => new Promise<never>(() => { /* in flight forever */ });
  void markOnboardingComplete(DOCTOR_A, deps(never, storage, reports));
  const { showWizard } = resolveOnboardingOnLoad(
    { id: DOCTOR_A, onboarding_completed_at: null },
    deps(never, storage, reports),
  );
  assert.equal(showWizard, false, 'a remount while the write is still in flight re-showed the wizard');
});

test('a suppressed mount RE-FIRES the write, and success spends the marker', async () => {
  const storage = fakeStorage();
  const reports: string[] = [];
  await markOnboardingComplete(DOCTOR_A, deps(() => Promise.reject({ status: 0 }), storage, reports));
  assert.equal(storage.map.has(completionMarkerKey(DOCTOR_A)), true);

  const recovered = flakyUpdateMe(0);
  const { showWizard } = resolveOnboardingOnLoad(
    { id: DOCTOR_A, onboarding_completed_at: null },
    deps(recovered.fn, storage, reports),
  );
  assert.equal(showWizard, false);
  await new Promise((r) => setImmediate(r)); // let the void re-fire settle
  assert.ok(recovered.calls >= 1, 'the suppressed mount did not re-attempt the write');
  assert.equal(storage.map.size, 0, 'the recovered re-fire must clear the marker');
});

// ── 2 · persistent failure becomes visible ───────────────────────────────────

test('a persistent failure alerts exactly once per run, numbers only, and keeps the marker', async () => {
  const storage = fakeStorage();
  const reports: string[] = [];
  const res = await markOnboardingComplete(DOCTOR_A, deps(() => Promise.reject({ status: 503 }), storage, reports));
  assert.deepEqual(res, { ok: false, attempts: TOTAL_ATTEMPTS });
  assert.deepEqual(reports, [buildCompletionFailedMessage(503, TOTAL_ATTEMPTS)]);
  assert.equal(storage.map.has(completionMarkerKey(DOCTOR_A)), true, 'the marker must survive to cover the next mount');
});

test('the alert survives the REAL scrub — and free text behind its tag does not', () => {
  const REDACTED = '[redacted: message not on the tag allowlist]';
  const scrub = (m: string) =>
    (scrubEvent({ message: m } as unknown as ErrorEvent) as unknown as Record<string, unknown>).message;

  for (const [status, attempts] of [[0, 3], [503, 3], [429, 2], [404, 1]] as const) {
    const m = buildCompletionFailedMessage(status, attempts);
    assert.equal(scrub(m), m, `alert redacted for status=${status} attempts=${attempts}`);
  }
  // Hostile / impossible inputs must still land INSIDE the pattern.
  for (const bad of [undefined, null, NaN, 99999, -1, '503', 403.5] as unknown[]) {
    const m = buildCompletionFailedMessage(bad, bad as never);
    assert.equal(scrub(m), m, `alert redacted for hostile input ${String(bad)}`);
  }
  // The floor: the tag alone licenses nothing.
  assert.equal(scrub('[onboarding] completion write failed: status=0 attempts=3 doctor=Иванов'), REDACTED,
    'a trailing field appended to the real message must still be redacted');
  assert.equal(scrub('[onboarding] пациент Иванов ЕГН 7501010010'), REDACTED,
    'free text behind the onboarding tag must still be redacted');
});

test('normaliseWriteStatus reads an ApiError-shaped status and treats everything else as 0', () => {
  assert.equal(normaliseWriteStatus({ status: 503 }), 503);
  assert.equal(normaliseWriteStatus({ status: 100 }), 100);
  for (const junk of [new TypeError('failed to fetch'), { status: '503' }, { status: 99999 }, null, undefined, 42]) {
    assert.equal(normaliseWriteStatus(junk), 0);
  }
});

// ── 3 · the marker is a hint, never an override ──────────────────────────────

test('a genuinely new doctor still gets the wizard — another doctor\'s marker cannot mask a fresh account', async () => {
  const storage = fakeStorage();
  const reports: string[] = [];
  await markOnboardingComplete(DOCTOR_A, deps(() => Promise.reject({ status: 0 }), storage, reports));
  const { showWizard } = resolveOnboardingOnLoad(
    { id: DOCTOR_B, onboarding_completed_at: null },
    deps(() => Promise.resolve({}), storage, reports),
  );
  assert.equal(showWizard, true, 'doctor A\'s marker hid the wizard from doctor B');
});

test('an id-less doctor gets no marker at all — nothing un-keyed can be written or read', async () => {
  const storage = fakeStorage();
  const reports: string[] = [];
  await markOnboardingComplete('', deps(() => Promise.reject({ status: 0 }), storage, reports));
  assert.equal(storage.map.size, 0, 'an un-keyed marker was written');
  const { showWizard } = resolveOnboardingOnLoad(
    { id: '', onboarding_completed_at: null },
    deps(() => Promise.resolve({}), storage, reports),
  );
  assert.equal(showWizard, true);
});

test('the server confirming completion spends the marker — the server stays the source of truth', () => {
  const storage = fakeStorage();
  const reports: string[] = [];
  storage.setItem(completionMarkerKey(DOCTOR_A), '1');
  const { showWizard } = resolveOnboardingOnLoad(
    { id: DOCTOR_A, onboarding_completed_at: '2026-09-02T10:00:00Z' },
    deps(() => Promise.resolve({}), storage, reports),
  );
  assert.equal(showWizard, false);
  assert.equal(storage.map.size, 0, 'a confirmed completion must delete the hint');
});

test('an ABSENT onboarding key (backend pre-015) shows nothing and touches nothing', () => {
  const storage = fakeStorage();
  const reports: string[] = [];
  storage.setItem(completionMarkerKey(DOCTOR_A), '1');
  let patched = 0;
  const { showWizard } = resolveOnboardingOnLoad(
    { id: DOCTOR_A },
    deps(() => { patched++; return Promise.resolve({}); }, storage, reports),
  );
  assert.equal(showWizard, false);
  assert.equal(patched, 0, 'the unknown path must not fire a PATCH');
  assert.equal(storage.map.size, 1, 'the unknown path must not touch the marker');
});

// ── 4 · storage that refuses ─────────────────────────────────────────────────

test('a throwing storage degrades to the pre-fix behaviour without breaking the alert', async () => {
  const reports: string[] = [];
  const res = await markOnboardingComplete(DOCTOR_A, deps(() => Promise.reject({ status: 500 }), throwingStorage, reports));
  assert.equal(res.ok, false);
  assert.deepEqual(reports, [buildCompletionFailedMessage(500, TOTAL_ATTEMPTS)]);
  for (const storage of [throwingStorage, null]) {
    const { showWizard } = resolveOnboardingOnLoad(
      { id: DOCTOR_A, onboarding_completed_at: null },
      deps(() => Promise.resolve({}), storage, reports),
    );
    assert.equal(showWizard, true, 'no marker readable → the server value decides, as before the fix');
  }
  assert.doesNotThrow(() => clearCompletionMarker(DOCTOR_A, throwingStorage));
});

// ── 5 · the browser wiring, pinned as source ─────────────────────────────────
// node --test cannot import a .tsx, so the two call sites are read as TEXT —
// branch-anchored checks, red-proven against mutated copies on every run
// (the scripts/access-form-alert.test.ts shape, with its caveat: this is the
// weaker kind of assertion, as strong as that kind gets).

const WIZARD = readFileSync(path.join(REPO, 'components', 'OnboardingWizard.tsx'), 'utf8');
const PAGE = readFileSync(path.join(REPO, 'app', '(workspace)', 'app', 'new-visit', 'page.tsx'), 'utf8');

type Check = { name: string; holds: (wizard: string, page: string) => boolean };

const CHECKS: Check[] = [
  {
    name: 'floor: both files were found and still are the wizard and the page',
    holds: (w, p) => w.length > 500 && /OnboardingWizard/.test(w) && p.length > 500 && /OnboardingWizard/.test(p),
  },
  {
    // ⚠ Hardened after the 2026-09-02 refuter round (B1'): the first cut banned
    // only `.catch`, so a `.then(noop, noop)` swallow rode back in behind a
    // dead-conditioned pinned call. Now: the call must stand as its OWN
    // 4-space-indented statement, finish() carries exactly ONE `if` (the
    // startTour fork), and no promise-swallow of updateMe survives anywhere.
    name: 'finish() routes through markOnboardingComplete — the swallowed-catch fire-and-forget is gone',
    holds: (w) => {
      const finish = /function finish\(startTour: boolean\) \{[\s\S]*?\n {2}\}/.exec(w);
      return !!finish
        && /^ {4}void markOnboardingComplete\(me\.id, onboardingCompletionDeps\(\)\);$/m.test(finish[0])
        // ascii-safe: counts the ASCII keyword `if` in TypeScript source code
        && (finish[0].match(/\bif\b/g) || []).length === 1
        && /if \(startTour\)/.test(finish[0])
        && !/updateMe\([^)]*\)\.(then|catch)/.test(w);
    },
  },
  {
    // ⚠ Refuter B2'': `deps.report = () => {}` after construction silenced the
    // alert with every pinned line intact. The deps object is built as one
    // literal and never reassigned — in either file.
    name: 'the deps cannot be rewired after construction — no .report/.updateMe/.storage assignment',
    holds: (w, p) => ![w, p].some((s) => /\.(report|updateMe|storage)\s*=(?!=)/.test(s)),
  },
  {
    name: 'the deps wire Sentry.captureMessage as the reporter, ungated by any env var',
    holds: (w) => {
      const b = /function onboardingCompletionDeps\(\)[\s\S]*?\n\}/.exec(w);
      return !!b
        && /report: \(m\) => Sentry\.captureMessage\(m, 'warning'\)/.test(b[0])
        && /updateMe: \(\) => api\.updateMe\(\{ onboarding_completed: true \}\)/.test(b[0])
        && !/process\.env\./.test(b[0]);
    },
  },
  {
    name: 'the page decision comes from resolveOnboardingOnLoad — no bare null-check re-show remains',
    holds: (_w, p) =>
      /resolveOnboardingOnLoad\(m, onboardingCompletionDeps\(\)\)\.showWizard/.test(p)
      && !/onboarding_completed_at === null\) setWizardOpen/.test(p),
  },
];

for (const c of CHECKS) {
  test(c.name, () => {
    assert.ok(c.holds(WIZARD, PAGE), `the wiring no longer satisfies: ${c.name}`);
  });
}

const MUTATIONS: Array<[string, (w: string, p: string) => [string, string]]> = [
  ['finish() reverts to the fire-and-forget swallow',
    (w, p) => [w.replace(/markOnboardingComplete\(me\.id, onboardingCompletionDeps\(\)\)/,
      "api.updateMe({ onboarding_completed: true }).catch(() => {})"), p]],
  ['the reporter is gated on NODE_ENV',
    (w, p) => [w.replace("report: (m) => Sentry.captureMessage(m, 'warning')",
      "report: (m) => { if (process.env.NODE_ENV === 'development') Sentry.captureMessage(m, 'warning'); }"), p]],
  ['the reporter is dropped to a no-op',
    (w, p) => [w.replace("report: (m) => Sentry.captureMessage(m, 'warning')", 'report: () => {}'), p]],
  ['the page reverts to the bare null check',
    (w, p) => [w, p.replace(/if \(resolveOnboardingOnLoad\(m, onboardingCompletionDeps\(\)\)\.showWizard\) setWizardOpen\(true\);/,
      'if (m.onboarding_completed_at === null) setWizardOpen(true);')]],
  // The two shapes the 2026-09-02 refuter round drove PAST the first cut of
  // these checks — kept here verbatim so the widened anchors stay earned.
  ["refuter B1': dead-conditioned pinned call + a .then(noop, noop) swallow",
    (w, p) => [w.replace('    void markOnboardingComplete(me.id, onboardingCompletionDeps());',
      '    if (false as boolean) {\n      void markOnboardingComplete(me.id, onboardingCompletionDeps());\n    }\n'
      + '    api.updateMe({ onboarding_completed: true }).then(() => {}, () => {});'), p]],
  ["refuter B1' variant: the pinned line kept at its own indent under a dead if",
    (w, p) => [w.replace('    void markOnboardingComplete(me.id, onboardingCompletionDeps());',
      '    if (false as boolean)\n    void markOnboardingComplete(me.id, onboardingCompletionDeps());'), p]],
  ["refuter B2'': the reporter is rewired to a no-op after construction",
    (w, p) => [w.replace('    void markOnboardingComplete(me.id, onboardingCompletionDeps());',
      '    const d = onboardingCompletionDeps();\n    d.report = () => {};\n    void markOnboardingComplete(me.id, d);'), p]],
];

test('every mutation that would re-open the silence breaks at least one wiring check', () => {
  const missed: string[] = [];
  for (const [label, mutate] of MUTATIONS) {
    const [mw, mp] = mutate(WIZARD, PAGE);
    assert.ok(mw !== WIZARD || mp !== PAGE, `MUTATION DID NOT APPLY: ${label} — its anchor has drifted`);
    if (CHECKS.every((c) => c.holds(mw, mp))) missed.push(label);
  }
  assert.deepEqual(missed, [],
    'these mutations left every check green — the gate cannot see them:\n  ' + missed.join('\n  '));
});
