// ─────────────────────────────────────────────────────────────────────────────
// A STATED TARGET IS NOT A MEASUREMENT — the COPD saturation ruling
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm test   (node --test, Node 24 strips the types natively.)
//
// „Целева сатурация 88-92%" is the standard COPD oxygen target. It rendered as
// «Тежка хипоксемия — SpO2 88% (норма >95)» — a red critical warning on a
// correctly-dictated treatment goal, in the specialty most likely to be first
// through the door.
//
// ⚠ THE SUPPRESSION IS THE DANGEROUS HALF. A rule that silences a real low
// saturation is strictly worse than the false positive it replaces, so every
// suppression case below is PAIRED with a case that must still mark, and
// several pairs put both in the SAME note — which is where a whole-note or
// forward-reaching rule fails and a clause-scoped backward one survives.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert';
import { findHighlights, isGoalScoped } from '../lib/vital-rules.ts';

/** Every vital highlight in `text`, as {raw, kind} — the rendered surface. */
function vitals(text: string) {
  return findHighlights(text)
    .filter((h) => h.kind === 'vital-critical' || h.kind === 'vital-warn')
    .map((h) => ({ raw: h.raw.trim(), kind: h.kind, message: h.message }));
}

// ── 0 · the gate is not blind ────────────────────────────────────────────────
// Without this, every „nothing was marked" assertion below is satisfied by a
// detector that marks nothing at all — the vacuity shape, and the whole reason
// this rule is risky.
test('POSITIVE CONTROL: a bare low saturation still marks as critical', () => {
  const v = vitals('Сатурация 88%.');
  assert.strictEqual(v.length, 1, `expected one mark, got ${JSON.stringify(v)}`);
  assert.strictEqual(v[0].kind, 'vital-critical');
});

test('POSITIVE CONTROL: the other vitals still mark', () => {
  assert.ok(vitals('t 39.5').length === 1, 'temperature');
  assert.ok(vitals('ЧСС 140').length === 1, 'heart rate');
});

// ── 1 · the founding case ────────────────────────────────────────────────────
test('„Целева сатурация 88-92%" is NOT a hypoxaemia warning', () => {
  assert.deepStrictEqual(vitals('Целева сатурация 88-92%.'), []);
});

// ── 2 · every word of the closed lexicon suppresses ──────────────────────────
for (const phrase of [
  'Целева сатурация 88%',
  'Цел: сатурация 88%',
  'Целта е сатурация 88%',
  'Таргетна сатурация 88%',
  'Поддържай сатурация 88%',
  'Поддържайте сатурация 88%',
  'Поддържане на сатурация 88%',
  'Стреми се към сатурация 88%',
  'Прицелна сатурация 88%',
]) {
  test(`goal word suppresses: „${phrase}"`, () => {
    assert.deepStrictEqual(vitals(phrase), [], phrase);
  });
}

// ── 3 · CLAUSE SCOPE — the suppression must not leak ─────────────────────────
// This is the arm that makes the feature safe. A whole-note rule passes every
// test above and fails all of these.
test('a goal in an EARLIER clause does not silence a real measurement', () => {
  const v = vitals('Целева сатурация 88-92%. Днес сатурация 79%.');
  assert.strictEqual(v.length, 1, `expected exactly the 79% mark, got ${JSON.stringify(v)}`);
  assert.ok(v[0].raw.includes('79'), v[0].raw);
  assert.strictEqual(v[0].kind, 'vital-critical');
});

test('a goal in an earlier clause of the SAME sentence does not leak past a comma', () => {
  const v = vitals('Целева сатурация 88-92%, при постъпване сатурация 76%');
  assert.strictEqual(v.length, 1, JSON.stringify(v));
  assert.ok(v[0].raw.includes('76'));
});

test('a colon is transparent ONLY straight after a goal word', () => {
  // „Цел:" introduces its own value, so this is silent…
  assert.deepStrictEqual(vitals('Цел: сатурация 88%'), []);
  // …but a colon that merely follows the target's value still ends the clause,
  // or the goal would reach across it and swallow the real reading.
  const v = vitals('Целева сатурация 88-92%: днес сатурация 79%');
  assert.ok(v.some((h) => h.raw.includes('79')), `79% must still mark: ${JSON.stringify(v)}`);
});

test('the real measurement marks even when the goal comes AFTER it', () => {
  // DIRECTION. A goal word governs what follows; a backward-only lookup is what
  // keeps this one marked. A forward-reaching rule silences it.
  const v = vitals('Сатурация 82%, целта е над 90');
  assert.ok(v.some((h) => h.raw.includes('82')), `82% must still mark: ${JSON.stringify(v)}`);
});

test('both in one note: the target is silent and the measurement marks', () => {
  const v = vitals('ХОББ. Целева сатурация 88-92%. При преглед сатурация 71%. t 36.6');
  assert.strictEqual(v.length, 1, JSON.stringify(v));
  assert.ok(v[0].raw.includes('71'));
});

// ── 4 · WHOLE-TOKEN, never by prefix (the ASCII-boundary lesson) ─────────────
// `\b` does not exist for Cyrillic, and a `цел`-prefix match eats ordinary
// words. Each of these contains a goal word as a SUBSTRING and must still mark.
for (const phrase of [
  'Целулит на подбедрицата, сатурация 88%',
  'Целесъобразно е изследване, сатурация 88%',
  'Целувка по бузата, сатурация 88%',
  'Стремежът на пациента настрана, сатурация 88%',
]) {
  test(`a substring is not a goal word: „${phrase}"`, () => {
    const v = vitals(phrase);
    assert.strictEqual(v.length, 1, `must still mark: ${JSON.stringify(v)}`);
    assert.ok(v[0].raw.includes('88'));
  });
}

test('„стремеж" as a whole token DOES suppress, so the pair above is a real distinction', () => {
  assert.deepStrictEqual(vitals('Стремеж: сатурация 88%'), []);
});

// ── 5 · bare „поддържа" is deliberately NOT a goal word ──────────────────────
test('third-person „поддържа" describes, and must NOT suppress', () => {
  const v = vitals('Болният поддържа сатурация 85%');
  assert.strictEqual(v.length, 1, `a described measurement must mark: ${JSON.stringify(v)}`);
});

// ── 6 · the rule generalises past SpO2 ───────────────────────────────────────
// „a stated target consumed as a measurement" is not a saturation-only shape.
test('a stated target suppresses other vitals too', () => {
  assert.deepStrictEqual(vitals('Целево ЧСС 45'), []);
  assert.strictEqual(vitals('ЧСС 45').length, 1, 'and the bare value still marks');
});

// ── 7 · case-insensitivity and the unit-level function ───────────────────────
test('the goal word matches regardless of case', () => {
  assert.deepStrictEqual(vitals('ЦЕЛЕВА САТУРАЦИЯ 88%'), []);
});

test('isGoalScoped is backward-only and clause-bounded', () => {
  const t = 'целева сатурация 88. сатурация 88';
  assert.strictEqual(isGoalScoped(t, t.indexOf('сатурация 88')), true);
  assert.strictEqual(isGoalScoped(t, t.lastIndexOf('сатурация 88')), false);
});

// ── 8 · the disabled-control check ───────────────────────────────────────────
// Gating behaviour on NODE_ENV passed every gate in this repo once, because no
// gate sets it: green in CI, different in the deployed build.
test('the suppression behaves identically under NODE_ENV=production', () => {
  const prev = process.env.NODE_ENV;
  try {
    // @ts-expect-error NODE_ENV is readonly in the Next types; this is a test.
    process.env.NODE_ENV = 'production';
    assert.deepStrictEqual(vitals('Целева сатурация 88-92%.'), []);
    assert.strictEqual(vitals('Сатурация 88%.').length, 1);
  } finally {
    // @ts-expect-error see above
    process.env.NODE_ENV = prev;
  }
});
