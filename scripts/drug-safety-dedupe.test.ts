// ─────────────────────────────────────────────────────────────────────────────
// lib/drug-safety.ts — #47: one alert per distinct issue.
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm run test   (node --test, Node 24 strips the types natively.)
//
// Dimitar's pilot report (#47): the same clinical issue renders ~4-5 times on
// the result page and the pile is overwhelming. The reproduction (baseline
// 10-afib-warfarin-nsaid): the backend CRITICAL already names BOTH drugs in
// its reason ("антикоагулантна терапия с варфарин... локалните НСПВС"), yet
// the frontend regex safety net re-states the same issue as an extra WARNING
// chip because the coverage check only looked at backend `triggers` (usually
// one normalized drug string), never at the alert text the doctor is already
// reading.
//
// THE SAFETY PROPERTY THESE TESTS PIN, both directions:
//   - a frontend alert is suppressed ONLY when every drug it fired on is
//     already named somewhere in a backend alert the doctor sees;
//   - a frontend hit on a drug the backend never mentions ALWAYS surfaces —
//     the safety net for typos/misses must survive this change.
//
// groupAlerts is presentation-only: identical (severity, message, action)
// entries collapse into one chip with a count; content is never rewritten.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  mergeBackendAlerts,
  groupAlerts,
  type SafetyAlert,
} from '../lib/drug-safety.ts';
import type { TranscribeFields } from '../lib/types.ts';

// Fixture shaped like baseline 10 (afib + warfarin + topical NSAID): the
// backend critical names both drugs in reason/action; the frontend interaction
// rule fires on ['диклофенак','варфарин'] from the same терапия text.
function warfarinFields(): TranscribeFields {
  return {
    anamneza: 'Предсърдно мъждене. Спонтанни кръвонасядания по предмишниците.',
    terapia: 'Варфарин 5 мг дневно. Локален Диклофенак гел за коляното.',
    medications_list: [
      { inn: 'варфарин', dose: '5 мг', regimen: 'дневно', route: '', duration: '' },
      { inn: 'диклофенак', dose: 'гел', regimen: 'локално', route: '', duration: '' },
    ],
  };
}

const backendCritical = {
  drug: 'диклофенак (локален НСПВС)',
  severity: 'CRITICAL',
  reason:
    'Пациентът е на антикоагулантна терапия с варфарин 5 мг дневно. Дори локалните НСПВС се абсорбират системно и могат да потенцират антикоагулантния ефект.',
  action: 'Замени диклофенак с парацетамол; контрол на INR.',
};

// ── Merge-layer suppression: the restatement class ───────────────────────────

test('#47: a frontend alert is suppressed when the backend alert text already names every trigger', () => {
  const merged = mergeBackendAlerts([backendCritical], warfarinFields());
  const frontend = merged.filter((a) => a.source === 'frontend');
  assert.equal(
    frontend.length,
    0,
    'the НСПВС+антикоагулант restatement must not render as an extra chip: ' +
      JSON.stringify(frontend.map((a) => a.message)),
  );
  assert.equal(merged.length, 1, 'the backend critical itself must survive untouched');
  assert.equal(merged[0].source, 'backend');
});

test('the safety net survives: a frontend hit on a drug the backend never mentions still surfaces', () => {
  // Same fields, but the backend alert names ONLY диклофенак — варфарин appears
  // nowhere in its triggers, reason, or action. The frontend interaction alert
  // (triggers диклофенак + варфарин) must NOT be swallowed.
  const backendPartial = {
    drug: 'диклофенак',
    severity: 'CRITICAL',
    reason: 'НСПВС при документирани кръвонасядания.',
    action: 'Замени с парацетамол.',
  };
  const merged = mergeBackendAlerts([backendPartial], warfarinFields());
  const frontend = merged.filter((a) => a.source === 'frontend');
  assert.equal(frontend.length, 1, 'partial backend coverage must never suppress the net');
});

test('coverage through backend text is case-insensitive', () => {
  const upper = {
    ...backendCritical,
    reason: 'Пациентът е на ВАРФАРИН и ДИКЛОФЕНАК едновременно.',
    action: '',
  };
  const merged = mergeBackendAlerts([upper], warfarinFields());
  assert.equal(merged.filter((a) => a.source === 'frontend').length, 0);
});

test('with no backend alerts at all, the frontend engine is untouched', () => {
  const merged = mergeBackendAlerts([], warfarinFields());
  assert.equal(merged.filter((a) => a.source === 'frontend').length, 1);
});

// ── Presentation grouping: identical chips collapse with a count ─────────────

function alert(over: Partial<SafetyAlert>): SafetyAlert {
  return {
    severity: 'warning',
    message: 'НСПВС + антикоагулант — повишен риск от кървене',
    triggers: ['аспирин'],
    source: 'backend',
    ...over,
  };
}

test('groupAlerts collapses identical (severity, message, action) into one entry with a count', () => {
  const groups = groupAlerts([
    alert({ triggers: ['аспирин'] }),
    alert({ triggers: ['варфарин'] }),
    alert({ triggers: ['ибупрофен'] }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 3);
  assert.deepEqual(
    [...groups[0].alert.triggers].sort(),
    ['аспирин', 'варфарин', 'ибупрофен'],
    'triggers must union so the meds-panel row flags keep firing for every drug',
  );
});

test('groupAlerts never conflates different content', () => {
  const groups = groupAlerts([
    alert({}),
    alert({ message: 'Друго предупреждение' }),
    alert({ severity: 'critical' }),
    alert({ action: 'Спри НСПВС' }),
  ]);
  assert.equal(groups.length, 4, 'message/severity/action differences are distinct issues');
  assert.ok(groups.every((g) => g.count === 1));
});

test('groupAlerts preserves first-seen order and does not mutate its input', () => {
  const first = alert({ message: 'A' });
  const input = [first, alert({ message: 'B' }), alert({ message: 'A', triggers: ['калий'] })];
  const before = JSON.stringify(input);
  const groups = groupAlerts(input);
  assert.equal(groups[0].alert.message, 'A');
  assert.equal(groups[1].alert.message, 'B');
  assert.equal(groups[0].count, 2);
  assert.equal(JSON.stringify(input), before, 'input alerts must not be mutated');
});
