// The lint gate CI actually runs (2026-08-19)
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// The workflow ran `npm run lint`, which is bare eslint, which exits 1 on any
// error. This repo carries 21 accepted pre-existing errors. So the job was RED
// ON master FROM THE DAY IT WAS ADDED.
//
// That is worse than having no gate. A job that is always red teaches the
// person reading it that red is what that job looks like — and two weeks later
// a real failure scrolls past unread. It is the ignorable-gate shape, arriving
// at the level of the thing that guards everything else.
//
// And it measured the wrong thing. AGENTS.md states the rule plainly: lint must
// introduce **zero new findings against the recorded baseline** — not zero
// findings. The rule was satisfied and the gate failed, which means the gate
// was wrong, not the code.
//
// ── WHAT IT ASSERTS ────────────────────────────────────────────────────────
// A RATCHET, not a ceiling. Three outcomes:
//
//   count == baseline   → pass.
//   count >  baseline   → FAIL. New findings, listed with file:line so the red
//                         is actionable rather than a number to argue with.
//   count <  baseline   → FAIL, differently. Someone fixed something and did
//                         not lower the baseline. That headroom is not a
//                         reward, it is room for the next regression to hide
//                         in — which is exactly how a baseline drifts back up.
//                         `npm run lint:ratchet -- --update` and commit.
//
// ── GRANULARITY, AND WHAT IT STILL CANNOT SEE ──────────────────────────────
// Comparison is PER RULE, not just on the total. A bare total lets a swap
// through: fix one finding, introduce a different one, total unchanged, gate
// green. Per-rule counts catch that whenever the two differ in rule — which is
// the overwhelmingly common case, since a new finding usually means a new kind
// of mistake.
//
// ⚠ RESIDUAL, stated rather than hidden: a swap WITHIN one rule (fix a
// `set-state-in-effect` in file A, add one in file B) is invisible to this
// gate. Going finer means keying on file paths, and a file-keyed baseline
// reds on every rename — a gate that cries wolf on refactors gets ignored,
// which is the exact disease being treated here. Per-rule is where that
// trade-off sits; the residual is real and is not pretended away.
//
// Run: npm run lint:ratchet          (CI)
//      npm run lint:ratchet -- --update   (after fixing something)

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_PATH = join(ROOT, '.eslint-baseline.json');

// ── The pure half. Exported and unit-tested (scripts/lint-ratchet.test.ts)
//    with a red proof, because a gate whose verdict logic is only exercised by
//    the gate itself has never been shown to go red.

/** Fold eslint's JSON report into { totals, byRule, findings }. */
export function tally(report) {
  const byRule = {};
  const findings = [];
  let errors = 0, warnings = 0;
  for (const file of report) {
    for (const m of file.messages || []) {
      const rule = m.ruleId || '(fatal)';
      byRule[rule] ??= { errors: 0, warnings: 0 };
      if (m.severity === 2) { errors++; byRule[rule].errors++; }
      else { warnings++; byRule[rule].warnings++; }
      findings.push({
        rule,
        severity: m.severity === 2 ? 'error' : 'warning',
        where: `${String(file.filePath).replace(ROOT, '').replace(/^[\\/]/, '')}:${m.line}:${m.column}`,
        message: m.message,
      });
    }
  }
  return { totals: { errors, warnings }, byRule, findings };
}

/**
 * The verdict. Pure: baseline and current are both plain objects.
 * Returns { verdict: 'ok' | 'regressed' | 'improved', regressions, improvements }.
 *
 * `regressed` outranks `improved`: if one rule got worse while another got
 * better, the thing that matters is the one that got worse.
 */
export function compareCounts(baseline, current) {
  const rules = new Set([...Object.keys(baseline.byRule || {}), ...Object.keys(current.byRule || {})]);
  const regressions = [], improvements = [];
  for (const rule of [...rules].sort()) {
    const b = (baseline.byRule || {})[rule] || { errors: 0, warnings: 0 };
    const c = (current.byRule || {})[rule] || { errors: 0, warnings: 0 };
    for (const sev of ['errors', 'warnings']) {
      if (c[sev] > b[sev]) regressions.push({ rule, severity: sev, was: b[sev], now: c[sev] });
      else if (c[sev] < b[sev]) improvements.push({ rule, severity: sev, was: b[sev], now: c[sev] });
    }
  }
  const verdict = regressions.length ? 'regressed' : improvements.length ? 'improved' : 'ok';
  return { verdict, regressions, improvements };
}

// ── The I/O half.

function runEslint() {
  // eslint exits 1 when it reports errors — expected here, so the non-zero exit
  // is not the signal. A real crash produces unparseable stdout, which IS.
  let stdout;
  try {
    stdout = execFileSync('npx', ['eslint', '--format', 'json'], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32',
    });
  } catch (err) {
    stdout = err.stdout;
    if (!stdout) {
      console.error('lint-ratchet: eslint produced no output — it crashed rather than reporting.');
      console.error(err.stderr || err.message);
      process.exit(2);
    }
  }
  try {
    return JSON.parse(stdout);
  } catch {
    console.error('lint-ratchet: eslint output was not JSON — refusing to guess.');
    console.error(String(stdout).slice(0, 2000));
    process.exit(2);
  }
}

function main() {
  const update = process.argv.includes('--update');
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const current = tally(runEslint());

  if (update) {
    const next = { ...baseline, recorded_at: new Date().toISOString().slice(0, 10),
                   totals: current.totals, byRule: current.byRule };
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8');
    console.log(`lint-ratchet: baseline updated → ${current.totals.errors} error(s), ${current.totals.warnings} warning(s).`);
    console.log('Commit .eslint-baseline.json with the change that caused it.');
    return 0;
  }

  const { verdict, regressions, improvements } = compareCounts(baseline, current);
  const b = baseline.totals, c = current.totals;
  console.log(`lint-ratchet: baseline ${b.errors}E/${b.warnings}W · current ${c.errors}E/${c.warnings}W`);

  if (verdict === 'ok') {
    console.log('✓ no new lint findings against the recorded baseline.');
    return 0;
  }

  if (verdict === 'regressed') {
    console.error('\n✗ NEW LINT FINDINGS — this change introduced them.\n');
    for (const r of regressions) console.error(`  ${r.rule} (${r.severity}): ${r.was} → ${r.now}`);
    const grew = new Set(regressions.map(r => r.rule));
    console.error('\nWhere:');
    for (const f of current.findings.filter(f => grew.has(f.rule))) {
      console.error(`  ${f.where}  ${f.severity}  ${f.rule}`);
      console.error(`      ${f.message.split('\n')[0]}`);
    }
    console.error('\nFix them. Do NOT raise the baseline — it only falls.');
    return 1;
  }

  console.error('\n✗ THE BASELINE IS STALE — findings were fixed and it was not lowered.\n');
  for (const i of improvements) console.error(`  ${i.rule} (${i.severity}): ${i.was} → ${i.now}`);
  console.error(`
That headroom is not a reward. Left in place it silently absorbs the next
regression, which is exactly how a baseline drifts back up to where it was.

  npm run lint:ratchet -- --update

…and commit .eslint-baseline.json alongside the fix.`);
  return 1;
}

// Only run when invoked directly, so the test file can import the pure half.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
