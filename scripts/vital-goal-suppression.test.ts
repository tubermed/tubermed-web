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
  const v = vitals('Сатурация 82% целта е над 90');
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
  'Целулит на подбедрицата сатурация 88%',
  'Целесъобразно е изследване сатурация 88%',
  'Целувка по бузата сатурация 88%',
  'Стремежът на пациента настрана сатурация 88%',
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

// ─────────────────────────────────────────────────────────────────────────────
// REFUTER ROUND (Batch 2.5) — the arms that were missing
// ─────────────────────────────────────────────────────────────────────────────
// A fresh-context refuter ran ~6,490 candidate sentences against the first cut
// and found the DANGEROUS direction wide open: 40 of 48 tested separators let a
// goal word reach past a completed reading and swallow the next one. Every case
// below was SILENT before the nearest-governor rewrite. These are the safety
// arms; if one of them ever goes red, a real abnormal vital is unmarked.

import { GOAL_WORDS } from '../lib/vital-rules.ts';

const SWALLOWED_BEFORE: Array<[string, string]> = [
  ['но, no comma', 'Пациент с ХОББ в екзацербация целева сатурация 88-92% но при постъпване сатурация 79% на стаен въздух'],
  ['em dash', 'ХОББ IV ст. Цел сатурация 88-92% — при постъпване сатурация 79%'],
  ['en dash', 'Цел сатурация 88-92% – при постъпване сатурация 79%'],
  ['TAB', 'Целева сатурация 88-92%\tАктуална сатурация 79%'],
  ['NBSP', 'Целева сатурация 88-92% Актуална сатурация 79%'],
  ['slash', 'Целева сатурация 88-92% / актуална сатурация 79%'],
  ['bullet', '• Целева сатурация 88-92% • сатурация 79%'],
  ['parenthesis', 'Кислородотерапия, целева сатурация 88-92% (сатурация 78% преди началото)'],
  ['а (conjunction)', 'Целева сатурация 88-92% а сега сатурация 79%'],
  ['обаче', 'Целева ДЧ 12-20 обаче ДЧ 38 в минута'],
  ['BP crisis after target', 'Целево АН под 140/90 но при постъпване АН 195/120 mmHg'],
  ['bradycardia after target', 'Целева ЧСС 60-80 но при преглед ЧСС 36 удара в минута'],
  ['fever after target', 'Целева температура под 37 но t 39.9'],
];

for (const [name, text] of SWALLOWED_BEFORE) {
  test(`DANGEROUS DIRECTION: a real abnormal vital survives a preceding target — ${name}`, () => {
    const v = vitals(text);
    assert.ok(v.length >= 1, `NOTHING MARKED — a real abnormal vital was swallowed: ${text}`);
  });
}

test('a goal word governing something ELSE does not reach the vital', () => {
  // Unbounded reach: the goal word need not govern the vital, it merely had to
  // be somewhere earlier in the clause. Measured at 80 filler words.
  assert.ok(vitals('Целта на лечението е ремисия на екзацербацията и понижаване на CRP сатурация 79%').length >= 1);
  assert.ok(vitals('Прегледът цели уточняване на диагнозата ЧСС 168 удара').length >= 1);
});

test('the colon exemption does not reach back across a completed clause', () => {
  // „не постигна целта:" — the colon introduces the MEASURED RESULT here.
  assert.ok(vitals('Пациентът не постигна целта: сатурация 79% на стаен въздух').length >= 1);
  assert.ok(vitals('Далеч сме от целта: АН 200/125 mmHg при постъпване').length >= 1);
  assert.ok(vitals('Не се достига целта: сатурация 78%').length >= 1);
  // …and the bare goal phrase is still exempt, or the founding fix regresses.
  assert.deepStrictEqual(vitals('Цел: сатурация 88%'), []);
  assert.deepStrictEqual(vitals('Терапевтична цел: сатурация 88-92%'), []);
});

test('a DATA-SANITY verdict is never suppressed — a target cannot be an inverted reading', () => {
  const v = vitals('Целево АН 130/80 при контрола АН 60/90');
  assert.ok(v.length >= 1, 'the systolic<=diastolic transcription-error check was swallowed');
  assert.match(v[0].message, /Невалидна стойност/);
});

test('EVERY clause-boundary character actually ends a clause', () => {
  // Individually, not as a set. A refuter dropped `\n`, `;`, `!` and `?` from
  // the class one at a time and the gate stayed green each time.
  for (const ch of ['.', ',', ';', ':', '!', '?', '\n', '\r', '\t', ' ', '—', '/', ')']) {
    const t = `Целева сатурация 88-92%${ch}сатурация 79%`;
    assert.ok(vitals(t).length >= 1, `boundary ${JSON.stringify(ch)} does not end the goal's reach`);
  }
});

test('the direction rule holds WITHOUT punctuation to help it', () => {
  // The original direction test read „Сатурация 82%, целта е над 90" — the
  // comma made it pass under a forward-reaching rule too.
  assert.ok(vitals('Сатурация 79% цел над 90').length >= 1);
});

test('GOAL_WORDS is pinned by exact content — adding a preposition silences everything', () => {
  // A refuter added 'до' and 'за'; every gate stayed green while
  // „Пациентът е за операция сатурация 79%" went silent.
  assert.ok(!GOAL_WORDS.includes('до'), '„до" is a preposition, not a goal word');
  assert.ok(!GOAL_WORDS.includes('за'), '„за" is a preposition, not a goal word');
  assert.ok(!GOAL_WORDS.includes('към'), '„към" is a preposition, not a goal word');
  assert.ok(!GOAL_WORDS.includes('при'), '„при" is a preposition, not a goal word');
  assert.strictEqual(GOAL_WORDS.length, 24, 'the lexicon changed — re-read the preposition finding');
  assert.ok(vitals('Пациентът е за операция сатурация 79%').length >= 1);
  assert.ok(vitals('Изпратен за консултация ЧСС 168').length >= 1);
});

// ── Each rule ISOLATED, so each is individually red-provable ────────────────
// The first red-proof battery showed R1 (intervening vital), R2 (conjunctions),
// R5 (data-sanity exemption) and R6 (the widened boundary class) could each be
// deleted with the gate still green — the distance bound alone covered every
// fixture. Defence in depth is fine; a rule no test can turn red is decoration.
// These four fixtures each sit INSIDE the distance bound, so only the named rule
// can save them.

test('ISOLATES the intervening-vital rule: a second reading right after the first', () => {
  // between = „сатурация 88 " — two words, inside MAX_GOAL_DISTANCE_TOKENS.
  // Only the intervening vital keyword can stop the goal reaching the 79.
  assert.ok(vitals('Целева сатурация 88 сатурация 79%').length >= 1);
});

test('ISOLATES the conjunction rule: a conjunction inside the distance bound', () => {
  // between = „стойност но " — two words. Only CONJUNCTIONS stops this.
  assert.ok(vitals('Целева стойност но сатурация 79%').length >= 1);
});

test('ISOLATES the widened boundary class: a dash inside the distance bound', () => {
  // between = „стойност — " — two words, no intervening vital, no conjunction.
  // Only the dash being a clause boundary stops this.
  assert.ok(vitals('Целева стойност — сатурация 79%').length >= 1);
  assert.ok(vitals('Целева стойност (сатурация 79%)').length >= 1);
});

test('ISOLATES the data-sanity exemption: an inverted reading right after a goal word', () => {
  // „Цел АН 60/90" — the goal word is adjacent, so every other rule allows the
  // suppression. systolic <= diastolic is a TRANSCRIPTION-ERROR verdict and must
  // survive it: a stated target cannot be an inverted reading.
  const v = vitals('Цел АН 60/90');
  assert.ok(v.length >= 1, 'the inverted-value check was swallowed by a goal word');
  assert.match(v[0].message, /Невалидна стойност/);
});
