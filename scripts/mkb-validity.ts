// Standalone parity test for the client-side МКБ validity (parent-accept) in
// lib/mkb10.ts — must agree with the backend gate (tubermed-backend
// lib/process-audio.js → mkbResolve) so a green code is never 409-rejected.
//
// The web repo has no unit-test runner; logic regressions run as standalone tsx.
// Run from the tubermed-web root: npx tsx scripts/mkb-validity.ts

import { readFileSync } from 'node:fs';
import { resolveMkb, isValidMkb, parentRubric, type MkbRow } from '../lib/mkb10';

// public/mkb10.json is the canonical [code, term][] list; resolveMkb only reads
// [0]/[1], so the raw 2-tuples satisfy it at runtime.
const data = JSON.parse(
  readFileSync(new URL('../public/mkb10.json', import.meta.url), 'utf8'),
) as unknown as MkbRow[];

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('  ✓ ' + msg); passed++; }
  else { console.error('  ✗ ' + msg); failed++; }
}

console.log(`loaded ${data.length} codes`);

// ── exact match ──
assert(isValidMkb(data, 'I10'), 'I10 exact valid');
assert(resolveMkb(data, 'I10').source === 'exact', 'I10 source = exact');
assert(resolveMkb(data, 'M76.9').term === 'Ентезопатия на долен крайник, неуточнена', 'M76.9 canonical term');

// ── parent-accept (off-register children kept exactly, labelled via parent) ──
for (const [child, parent] of [['I48.1', 'I48'], ['K26.6', 'K26'], ['E11.4', 'E11']] as const) {
  const r = resolveMkb(data, child);
  assert(r.ok && r.source === 'parent', `${child} parent-accepts via ${parent} (source=parent)`);
}
// the ".-" placeholder form of a parent rubric
{
  const r = resolveMkb(data, 'F17.2');
  assert(r.ok && r.source === 'parent', 'F17.2 parent-accepts via the F17.- placeholder');
}
assert(parentRubric('I48.1') === 'I48', "parentRubric('I48.1') === 'I48'");

// ── garbage / missing ──
assert(!isValidMkb(data, 'ZZZ.9'), 'ZZZ.9 invalid (no exact, no valid parent)');
assert(!isValidMkb(data, ''), 'empty string invalid');
assert(isValidMkb(data, 'i10'), 'lowercase i10 normalizes to valid (case parity with server)');

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
