// scripts/deployed-tint-pairing.test.ts — the served-pair verdict behind
// scripts/probe-deployed-tint.mjs, fed every shape it exists to reject.
//
// The probe itself needs prod, so it is not in `npm test`; the verdict is pure
// and is. Section 2 is the red proof: the exact served shape of 2026-08-22
// (new JS, stale sheet) must be exit 1, and a shell the probe cannot read must
// be exit 2 — never 0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verdict } from './deployed-tint-pairing.mjs';

const ROOT = join(import.meta.dirname, '..');
const SOURCE_CSS = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');

// A minified sheet in the shape lightningcss emits for the real rules.
const GOOD_CSS = '@layer theme{:root,:host{--color-gold:#b7791f;--color-ai-tint:#eef4fb;--color-ai-dot:#2f5c8f}}'
  + '@media print{body{background:#fff!important}.ai-authored:after,.ai-authored:before{display:none!important}@page{margin:18mm 16mm}}'
  + '.print-only{display:none}.ai-authored{position:relative;isolation:isolate}'
  + '.ai-authored:after{content:"";background:var(--color-ai-tint);border-radius:12px;position:absolute;inset:-8px -14px -6px;z-index:-1}';
const STALE_CSS = GOOD_CSS.replace(/--color-ai-tint:#eef4fb;--color-ai-dot:#2f5c8f/, '').replace(/\.ai-authored[^}]*\}/g, '');
const GOOD_JS = 'function x(a){return a?"scroll-mt-24 ai-authored":"scroll-mt-24"}';
const OLD_JS  = 'function x(a){return "scroll-mt-24"}';

const shell = (css: string[], js: string[]) =>
  `<html><head>${css.map((u) => `<link rel="stylesheet" href="${u}">`).join('')}</head><body>${js.map((u) => `<script src="${u}"></script>`).join('')}</body></html>`;
const serve = (files: Record<string, string>) => async (u: string) => {
  if (!(u in files)) throw new Error(`404 ${u}`);
  return files[u];
};

const CSS_U = '/_next/static/immutable/chunks/a.css';
const JS_U  = '/_next/static/immutable/chunks/b.js';

test('the stale sheet is not a false fixture: it lost the rule AND the token', () => {
  assert.ok(GOOD_CSS.includes('--color-ai-tint') && GOOD_CSS.includes('.ai-authored:after'));
  assert.ok(!STALE_CSS.includes('--color-ai-tint') && !STALE_CSS.includes('.ai-authored'));
  assert.ok(STALE_CSS.includes('--color-gold'), 'the stale sheet is still the app sheet');
});

test('the source stylesheet matches the shape the probe looks for (minified by hand)', () => {
  // If globals.css drifts away from `::after` + the token, the probe would
  // start failing for a reason this file should name first.
  assert.match(SOURCE_CSS, /\.ai-authored::after\s*\{[^}]*background:\s*var\(--color-ai-tint\)/);
  assert.match(SOURCE_CSS, /--color-ai-tint:\s*#[0-9A-Fa-f]{6}/);
});

test('a paired deploy is exit 0', async () => {
  const v = await verdict(shell([CSS_U], [JS_U]), serve({ [CSS_U]: GOOD_CSS, [JS_U]: GOOD_JS }));
  assert.equal(v.code, 0, v.lines.join('\n'));
});

// ── Red proof ───────────────────────────────────────────────────────────────
test('RED PROOF — 2026-08-22: new JS next to a stale sheet is exit 1, naming the sheet', async () => {
  const v = await verdict(shell([CSS_U], [JS_U]), serve({ [CSS_U]: STALE_CSS, [JS_U]: GOOD_JS }));
  assert.equal(v.code, 1);
  assert.match(v.lines[0], /stale CSS compile/);
  assert.match(v.lines[0], /--color-ai-tint/);
});
test('RED PROOF — a sheet with the rule but no token is exit 1 (the rule would paint transparent)', async () => {
  const NO_TOKEN = GOOD_CSS.replace('--color-ai-tint:#eef4fb;', '');
  const v = await verdict(shell([CSS_U], [JS_U]), serve({ [CSS_U]: NO_TOKEN, [JS_U]: GOOD_JS }));
  assert.equal(v.code, 1);
  assert.match(v.lines[0], /defines --color-ai-tint/);
});
test('RED PROOF — a sheet that forgot the print neutraliser is exit 1', async () => {
  const NO_PRINT = GOOD_CSS.replace('.ai-authored:after,.ai-authored:before{display:none!important}', '');
  const v = await verdict(shell([CSS_U], [JS_U]), serve({ [CSS_U]: NO_PRINT, [JS_U]: GOOD_JS }));
  assert.equal(v.code, 1);
  assert.match(v.lines[0], /@media print/);
});
test('RED PROOF — the right sheet next to pre-tint JS is exit 1 too (the pair, not the sheet)', async () => {
  const v = await verdict(shell([CSS_U], [JS_U]), serve({ [CSS_U]: GOOD_CSS, [JS_U]: OLD_JS }));
  assert.equal(v.code, 1);
  assert.match(v.lines[0], /no linked script/);
});
test('RED PROOF — a shell with no stylesheet link is exit 2, never 0', async () => {
  const v = await verdict(shell([], [JS_U]), serve({ [JS_U]: GOOD_JS }));
  assert.equal(v.code, 2);
  assert.match(v.lines[0], /BLIND/);
});
test('RED PROOF — a linked asset that does not fetch is an error, not a pass', async () => {
  await assert.rejects(verdict(shell([CSS_U], [JS_U]), serve({ [JS_U]: GOOD_JS })), /404/);
});
