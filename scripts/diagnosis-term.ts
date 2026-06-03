// Standalone test for the deterministic diagnosis-term helpers (lib/diagnosis.ts):
// official-term-wins filing + the "доктор каза" divergence cue. No API, no runner.
// Run from the tubermed-web root: npx tsx scripts/diagnosis-term.ts

import { filedMainTerm, filedComorbidityTerm, spokenDivergesFromOfficial } from '../lib/diagnosis';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string) {
  if (c) { console.log('  ✓ ' + m); passed++; }
  else { console.error('  ✗ ' + m); failed++; }
}

// ── filed term: official МКБ term wins, spoken is the fallback ──
assert(
  filedMainTerm({ osnovna_mkb: 'I10', osnovna_mkb_term: 'Есенциална [първична] хипертония', osnovna_diagnoza: 'първична хипертония' })
    === 'Есенциална [първична] хипертония',
  'main: official term wins over spoken',
);
assert(filedMainTerm({ osnovna_diagnoza: 'нещо' }) === 'нещо', 'main: falls back to spoken when no official term');
assert(
  filedComorbidityTerm({ mkb: 'E11', mkb_term: 'Неинсулинозависим захарен диабет', diagnoza: 'диабет' })
    === 'Неинсулинозависим захарен диабет',
  'comorbidity: official term wins',
);
assert(filedComorbidityTerm({ mkb: '', diagnoza: 'нещо' }) === 'нещо', 'comorbidity: falls back to spoken');

// ── "доктор каза" cue ──
assert(spokenDivergesFromOfficial('първична хипертония', 'Есенциална [първична] хипертония') === false, 'contained rewording → no cue (hypertension worked example)');
assert(spokenDivergesFromOfficial('навехнат глезен', 'Контузия на глезена') === true, 'wrong-code mismatch → cue (ankle worked example)');
assert(spokenDivergesFromOfficial('Астма', 'Астма') === false, 'exact match → no cue');
assert(spokenDivergesFromOfficial('', 'Астма') === false, 'empty spoken → no cue');
assert(spokenDivergesFromOfficial('диабет', '') === false, 'no official term → no cue');

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
