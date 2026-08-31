// ─────────────────────────────────────────────────────────────────────────────
// The landing lead form REPORTS its failures — the witness itself, gated
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS (2026-08-31). The lead form had captured zero leads since
// it shipped and nobody at TuberMed found out. The reason the backend could not
// have seen it: the form is served from www.tubermed.com, the API's CORS
// allowlist held only app.tubermed.com, so the preflight was refused and the
// POST was NEVER DISPATCHED. No request existed to log.
//
// The fix's own commit message says "the browser is the only witness a refused
// preflight ever has" — and then shipped that witness with no test of its own.
// A refuter deleted `reportSubmitFailed(0)` from the catch block, and separately
// replaced the `!res.ok` branch with `setStatus('success')`, and BOTH passed
// 534/534 with tsc clean. The second one is worse than the original defect:
// against today's live 500/42501 every visitor would be told „Благодаря!" while
// nothing is stored and no alert fires.
//
// ⚠ WHAT THIS GATE IS, HONESTLY. It reads AccessForm.tsx as TEXT. It is not an
// executed test — `node --test scripts/*.test.ts` cannot import a .tsx, and
// standing up React to click a form is not in this batch. So it is the weaker
// kind of assertion, and it is written to be as strong as that kind gets:
//
//   • the backend learned in this same batch that PRESENCE IS NOT PLACEMENT —
//     a first cut asserted `reportInsertRefused(` appeared anywhere in the file,
//     and deleting it from the refusal branch left the catch-all's identical
//     call behind and the gate stayed green. So every assertion here is anchored
//     to the BRANCH it belongs to, and the call-site count is pinned so neither
//     branch can be deleted by "simplifying" the other;
//   • and the whole set is red-proven ON EVERY RUN against mutated copies of the
//     real source (see the last test) — the exact two mutations that got past
//     nothing, plus the ones a reader would try next. A source-level gate that
//     has never been shown to fail is decoration twice over.
//
// The message itself is tested for real in scripts/sentry-scrub.test.ts, which
// runs lib/pilot-lead-alert.ts's formatter through the real scrub.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const FORM = path.join(REPO, 'components', 'landing', 'AccessForm.tsx');

const SOURCE = readFileSync(FORM, 'utf8');

// ── The checks, as functions over source text, so they can be run against
//    MUTATED copies to prove they go red. ────────────────────────────────────
type Check = { name: string; holds: (src: string) => boolean };

/** Just the submit handler — so a check cannot read the reporter's own catch. */
function submitBody(s: string): string {
  const at = s.indexOf('async function handleSubmit');
  return at === -1 ? '' : s.slice(at);
}

/** The CALL sites, never the declaration. */
function reportCalls(s: string): string[] {
  return (s.match(/(^|[^a-zA-Z.])reportSubmitFailed\([^)]*\)/gm) || [])
    .map((m) => m.slice(m.indexOf('reportSubmitFailed')))
    .filter((m) => !/^reportSubmitFailed\(status: /.test(m));
}

const CHECKS: Check[] = [
  {
    // The floor. Everything below is satisfied by an empty string.
    name: 'the component was found and still posts to the lead endpoint',
    holds: (s) => s.length > 500 && /fetch\(`\$\{BACKEND\}\/api\/pilot-leads`/.test(s),
  },
  {
    name: 'the message comes from lib/pilot-lead-alert, not an inline literal',
    holds: (s) => /import \{ buildSubmitFailedMessage \} from '@\/lib\/pilot-lead-alert';/.test(s)
      && !/`\[pilot-leads\]/.test(s),
  },
  {
    name: 'the reporter calls Sentry.captureMessage with that formatter',
    holds: (s) => /Sentry\.captureMessage\(buildSubmitFailedMessage\(status, submitFailures\), 'error'\)/.test(s),
  },
  {
    // The refuter's NODE_ENV trick, applied on this side: nothing sets NODE_ENV
    // in production, so a development gate is a dead alarm that reads as a fix.
    name: 'nothing gates the report on an environment variable',
    holds: (s) => {
      const reporter = /function reportSubmitFailed[\s\S]*?\n\}/.exec(s);
      return !!reporter && !/process\.env\./.test(reporter[0]);
    },
  },
  {
    name: 'the counter ACCUMULATES (`+= 1`, not `= 1`) — count=1 forever is a lie',
    holds: (s) => /submitFailures \+= 1;/.test(s) && !/submitFailures = 1;/.test(s),
  },
  {
    // ⚠ BRANCH-ANCHORED, and anchored inside handleSubmit specifically. The
    // first cut matched the first `} catch {` in the file, which is
    // reportSubmitFailed's OWN catch — a gate reading the wrong block is the
    // same defect one level up, and it showed itself immediately.
    name: 'the CATCH branch reports status 0 — the refused-preflight case itself',
    holds: (s) => {
      const block = /\} catch \{[\s\S]*?setStatus\('error'\);[\s\S]*?\n {4}\}/.exec(submitBody(s));
      return !!block && /reportSubmitFailed\(0\);/.test(block[0]);
    },
  },
  {
    // ⚠ BRANCH-ANCHORED. The refuter replaced this whole block with
    // setStatus('success'), which tells every visitor they signed up.
    name: 'the !res.ok branch reports the REAL status and sets error, never success',
    holds: (s) => {
      const block = /if \(!res\.ok\) \{[\s\S]*?\n {6}\}/.exec(s);
      return !!block
        && /reportSubmitFailed\(res\.status\);/.test(block[0])
        && /setStatus\('error'\)/.test(block[0])
        && !/setStatus\('success'\)/.test(block[0]);
    },
  },
  {
    name: 'exactly two report call sites, so neither branch can be dropped quietly',
    holds: (s) => (s.match(/reportSubmitFailed\(/g) || []).length === 3, // 1 definition + 2 calls
  },
  {
    // The success path must stay silent, or the alert's count means nothing.
    name: 'the success path does not report',
    holds: (s) => {
      const after = s.slice(s.indexOf("setStatus('success');"));
      return !/reportSubmitFailed/.test(after.slice(0, 200));
    },
  },
  {
    // PII floor. The form's payload IS a name and an e-mail address; the
    // reporter may be handed a status and nothing else.
    name: 'the report is handed a status and a count — never a field value',
    holds: (s) => {
      const calls = reportCalls(s);
      return calls.length === 2
        && calls.every((c) => /^reportSubmitFailed\((0|res\.status)\)$/.test(c));
    },
  },
];

for (const c of CHECKS) {
  test(c.name, () => {
    assert.ok(c.holds(SOURCE), `AccessForm.tsx no longer satisfies: ${c.name}`);
  });
}

// ── The red proof, on every run ──────────────────────────────────────────────
// Each mutation is applied to a COPY of the real source and must break at least
// one check. Two of them are the refuter's, verbatim; the rest are what a reader
// would reach for next. A source-level gate is only worth its length if it can
// be shown to fail, and showing it once at authoring time is not showing it.
const MUTATIONS: Array<[string, (s: string) => string]> = [
  ['the catch stops reporting (refuter)',
    (s) => s.replace('      reportSubmitFailed(0);\n', '')],
  ['the !res.ok branch reports nothing (refuter)',
    (s) => s.replace('        reportSubmitFailed(res.status);\n', '')],
  ['the !res.ok branch claims success (refuter)',
    (s) => s.replace(/if \(!res\.ok\) \{[\s\S]*?\n {6}\}/, "if (!res.ok) {\n        setStatus('success');\n        return;\n      }")],
  ['the report is gated on NODE_ENV',
    (s) => s.replace('    Sentry.captureMessage(', "    if (process.env.NODE_ENV === 'development') Sentry.captureMessage(")],
  ['the counter stops accumulating',
    (s) => s.replace('submitFailures += 1;', 'submitFailures = 1;')],
  ['the name is passed to the reporter',
    (s) => s.replace('reportSubmitFailed(res.status);', 'reportSubmitFailed(name);')],
  ['captureMessage is dropped from the reporter',
    (s) => s.replace(/Sentry\.captureMessage\([^;]*\);/, '')],
];

test('every mutation that would re-hide the failure breaks at least one check', () => {
  const missed: string[] = [];
  for (const [label, mutate] of MUTATIONS) {
    const mutated = mutate(SOURCE);
    assert.notStrictEqual(mutated, SOURCE, `MUTATION DID NOT APPLY: ${label} — its anchor has drifted`);
    const survived = CHECKS.every((c) => c.holds(mutated));
    if (survived) missed.push(label);
  }
  assert.deepStrictEqual(
    missed,
    [],
    'these mutations left every check green — the gate cannot see them:\n  ' + missed.join('\n  '),
  );
});
