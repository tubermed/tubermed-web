// The lint ratchet's verdict logic (2026-08-19)
//
// scripts/lint-ratchet.mjs is what CI runs in place of bare `npm run lint`,
// which was red on master from the day it was added. Its verdict logic decides
// whether a red is real, so it needs a gate of its own — a gate whose only
// exercise is the gate itself has never been shown to go red.
//
// The live demonstration (add one `set-state-in-effect`, watch it fail; remove
// it, watch it pass; then desync the baseline and watch it fail differently)
// was run by hand on 2026-08-19 and is recorded in the commit. This file is the
// part that runs on every push.
//
// Run: node --test scripts/lint-ratchet.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tally, compareCounts, BASELINE_PATH } from './lint-ratchet.mjs';

const ROOT = join(import.meta.dirname, '..');

// A minimal eslint --format json report.
const report = (...msgs: Array<[string, number, number]>) => [{
  filePath: join(ROOT, 'components', 'Probe.tsx'),
  messages: msgs.map(([ruleId, severity, line]) => ({ ruleId, severity, line, column: 1, message: 'x' })),
}];

type RuleCounts = Record<string, { errors: number; warnings: number }>;

test('tally folds an eslint report into totals + per-rule counts', () => {
  const t = tally(report(['a/rule', 2, 10], ['a/rule', 2, 11], ['b/rule', 1, 12]));
  const byRule = t.byRule as RuleCounts;
  assert.deepEqual(t.totals, { errors: 2, warnings: 1 });
  assert.deepEqual(byRule['a/rule'], { errors: 2, warnings: 0 });
  assert.deepEqual(byRule['b/rule'], { errors: 0, warnings: 1 });
  assert.equal(t.findings.length, 3);
  assert.match(t.findings[0].where, /components[\\/]Probe\.tsx:10:1/);
});

test('an unchanged count passes', () => {
  const base = { byRule: { 'a/rule': { errors: 3, warnings: 0 } } };
  assert.equal(compareCounts(base, base).verdict, 'ok');
});

test('one MORE finding of a known rule fails as a regression', () => {
  const r = compareCounts(
    { byRule: { 'a/rule': { errors: 3, warnings: 0 } } },
    { byRule: { 'a/rule': { errors: 4, warnings: 0 } } },
  );
  assert.equal(r.verdict, 'regressed');
  assert.deepEqual(r.regressions, [{ rule: 'a/rule', severity: 'errors', was: 3, now: 4 }]);
});

test('a finding of a BRAND NEW rule fails, even though the rule is absent from the baseline', () => {
  const r = compareCounts(
    { byRule: { 'a/rule': { errors: 3, warnings: 0 } } },
    { byRule: { 'a/rule': { errors: 3, warnings: 0 }, 'new/rule': { errors: 1, warnings: 0 } } },
  );
  assert.equal(r.verdict, 'regressed');
  assert.equal(r.regressions[0].rule, 'new/rule');
});

test('a new WARNING fails too — warnings drift up as easily as errors', () => {
  const r = compareCounts(
    { byRule: { 'a/rule': { errors: 0, warnings: 2 } } },
    { byRule: { 'a/rule': { errors: 0, warnings: 3 } } },
  );
  assert.equal(r.verdict, 'regressed');
  assert.equal(r.regressions[0].severity, 'warnings');
});

test('THE RATCHET — a count that DROPPED fails until the baseline is lowered', () => {
  const r = compareCounts(
    { byRule: { 'a/rule': { errors: 3, warnings: 0 } } },
    { byRule: { 'a/rule': { errors: 1, warnings: 0 } } },
  );
  assert.equal(r.verdict, 'improved',
    'headroom left in the baseline silently absorbs the next regression');
  assert.deepEqual(r.improvements, [{ rule: 'a/rule', severity: 'errors', was: 3, now: 1 }]);
});

test('a regression OUTRANKS an improvement — the thing that got worse is the news', () => {
  const r = compareCounts(
    { byRule: { 'a/rule': { errors: 3, warnings: 0 }, 'b/rule': { errors: 0, warnings: 0 } } },
    { byRule: { 'a/rule': { errors: 1, warnings: 0 }, 'b/rule': { errors: 5, warnings: 0 } } },
  );
  assert.equal(r.verdict, 'regressed');
  assert.equal(r.regressions[0].rule, 'b/rule');
});

test('a same-total SWAP across rules is caught — a bare total would miss it', () => {
  // This is the whole reason the baseline is per-rule and not a single number.
  const r = compareCounts(
    { byRule: { 'a/rule': { errors: 2, warnings: 0 }, 'b/rule': { errors: 0, warnings: 0 } } },
    { byRule: { 'a/rule': { errors: 1, warnings: 0 }, 'b/rule': { errors: 1, warnings: 0 } } },
  );
  assert.equal(r.verdict, 'regressed');
});

test('the committed baseline is internally consistent', () => {
  const b = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const sum = Object.values(b.byRule as Record<string, { errors: number; warnings: number }>)
    .reduce((a, r) => ({ errors: a.errors + r.errors, warnings: a.warnings + r.warnings }),
            { errors: 0, warnings: 0 });
  assert.deepEqual(sum, b.totals,
    'byRule must sum to totals — a baseline that disagrees with itself is not a source of truth');
  assert.ok(typeof b.why === 'string' && b.why.length > 80,
    'the baseline must carry the REASON the residual is accepted, or it becomes a number nobody can challenge');
});

test('AGENTS.md points at the baseline file rather than repeating the number', () => {
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /\.eslint-baseline\.json/,
    'AGENTS.md must reference the file — a count typed in two places will disagree with itself');
  // The specific failure being prevented: a hardcoded total that the ratchet
  // can lower without anyone updating the prose.
  const b = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const total = b.totals.errors + b.totals.warnings;
  const lintLines = agents.split('\n').filter((l) => /lint/i.test(l));
  // Unicode-aware boundaries, never \b: AGENTS.md is English prose carrying
  // Bulgarian quotes, and JS \b is ASCII-only, so it reports a boundary
  // between a digit and a Cyrillic letter that is not one. Same rule
  // scripts/ascii-boundary.test.ts enforces on shipped source.
  const restated = lintLines.filter((l) =>
    new RegExp(`(?<![\\p{L}\\p{N}_])${total}(?![\\p{L}\\p{N}_])`, 'u').test(l)
    && !/eslint-baseline/.test(l));
  assert.equal(restated.length, 0,
    `AGENTS.md restates the lint total (${total}) in prose: ${restated.join(' | ')}`);
});

test('CI runs the ratchet, not bare eslint', () => {
  const wf = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(wf, /npm run lint:ratchet/, 'the workflow must run the ratchet');
  assert.ok(!/^\s*-\s*run:\s*npm run lint\s*$/m.test(wf),
    'bare `npm run lint` in CI is the red-on-master gate this replaced');
});
