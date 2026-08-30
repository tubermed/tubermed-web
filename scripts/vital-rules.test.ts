// ─────────────────────────────────────────────────────────────────────────────
// vital-rules — the left boundary, and the thresholds behind it
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm test   (node --test, Node 24 strips the types natively.)
//
// WHY THIS FILE EXISTS: lib/vital-rules.ts shipped with ZERO coverage. No test,
// no script, nothing — `grep -rln "vital-rules|findHighlights" scripts/` was
// empty. So no instrument could ever have caught what was in it:
//
//   "ПКК: Hb 138 g/l, Hct 42%, PLT 245, Leu 6.4"
//       → vital-critical | Висока температура — 42°C
//   "Лозартан 25-100 мг дневно"
//       → vital-critical | Невалидна стойност — систолно (25) ≤ диастолно (100)
//
// Not one of the five rules carried a left boundary. Measured before the fix,
// 75 of 75 glue probes leaked: every keyword spelling in every rule matched
// mid-word. The temperature rule was merely the one whose keyword was short
// enough (`t`, in `t°?` with the degree sign optional) to collide with real
// clinical text — Hct, PLT, ALT, GGT, AST, aPTT — and the blood-pressure rule's
// `АН`, case-insensitively, is the tail of лозартан / валсартан / телмисартан,
// so an antihypertensive DOSE RANGE rendered as a red transcription error.
//
// Why that outranks its size: red is this product's reserved medication-safety
// colour (`--color-danger`, "Don't use it decoratively"). Firing it on normal
// haematology does not add noise — it teaches the doctor that red means
// nothing, which disarms the one signal that must never be ignored.
//
// SHAPE OF THIS GATE. Four layers, all executed against the real module:
//   1. vacuity — the rule set must be non-empty and every rule must be probed;
//   2. coverage — every top-level keyword SPELLING in every rule's pattern must
//      be exercised by a probe, so adding a spelling without a probe goes red;
//   3. the boundary INVARIANT — every match returned must begin at a word
//      start, asserted with a character class written out here, independent of
//      the one in lib/vital-rules.ts. Sharing that predicate would be the
//      fixture-agreement bypass: a mutation to it would flip both sides at
//      once and the gate would stay green;
//   4. the thresholds — so a mutation to any single rule's classifier is red
//      even though the boundary is one shared function.
//
// 🚫 `\b` IS NOT AVAILABLE HERE. JS `\b`, `\w`, `\W` are ASCII-only and the `u`
// flag does not change it, so `\bт` is TRUE mid-Cyrillic-word and FALSE at the
// start of one — the exact inversion. See scripts/ascii-boundary.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { findHighlights, VITAL_RULES } from '../lib/vital-rules.ts';

const REPO = path.resolve(import.meta.dirname, '..');

type Mark = { start: number; end: number; kind: string; raw: string; label: string; message: string };

function vitals(text: string): Mark[] {
  return findHighlights(text).filter((h) => h.kind === 'vital-warn' || h.kind === 'vital-critical');
}

// ── The gate's OWN boundary predicate ────────────────────────────────────────
// Written out as an explicit character class — Latin, digits, and the Cyrillic
// block — rather than reusing lib/vital-rules.ts's `\p{L}\p{N}` test. Two
// independent spellings of the same idea; a mutation to one does not move the
// other. ascii-safe by construction: this is an enumerated class, not `\w`.
const GATE_WORD_CHAR = /[A-Za-z0-9Ѐ-ӿԀ-ԯ]/;

function beginsAtWordStart(text: string, start: number): boolean {
  if (start <= 0) return true;
  return !GATE_WORD_CHAR.test(text[start - 1]);
}

// ── Probes, per rule ─────────────────────────────────────────────────────────
// Every keyword spelling each rule accepts gets a probe, so the answer for one
// spelling is never read as the answer for the rule. Values chosen to fire.
const PROBES: Record<string, string[]> = {
  temp: [
    'температура 38.2',
    'температурата 38.2',
    'темп. 38.2',
    'темп 38.2',
    't 38.2',
    't° 38.2',
    'т° 38.2',
    't-ра 38.2',
  ],
  bp: [
    'кръвно 155/95',
    'кръвно налягане 155/95',
    'артериално налягане 155/95',
    'АН 155/95',
    'RR 155/95',
    'кръвно 155 на 95',
  ],
  hr: ['пулс 118', 'сърдечна честота 118', 'ЧСС 118', 'HR 118'],
  spo2: ['сатурация 88', 'SpO2 88', 'SatO2 88', 'кислородна сатурация 88'],
  rr: ['ДЧ 28', 'ЧД 28', 'дихателна честота 28', 'честота на дишане 28', 'честота на дишането 28'],
};

// ── 1 · Vacuity ──────────────────────────────────────────────────────────────
// Three gates in this repo passed this week by measuring nothing. If the rule
// set is empty, or a rule has no probe, this throws rather than reporting green.

test('vacuity — the rule set is non-empty and every rule is probed', () => {
  assert.ok(VITAL_RULES.length > 0, 'VACUOUS: VITAL_RULES resolved to zero rules');
  assert.ok(
    VITAL_RULES.length >= 5,
    `VACUOUS: expected at least the 5 shipped rules, found ${VITAL_RULES.length}`,
  );

  const probed = new Set(Object.keys(PROBES));
  const shipped = VITAL_RULES.map((r) => r.category);
  const unprobed = shipped.filter((c) => !probed.has(c));
  assert.deepStrictEqual(
    unprobed,
    [],
    `rule(s) with no probe — add them to PROBES: ${unprobed.join(', ')}`,
  );

  // And every probe must actually FIRE. A probe that matches nothing measures
  // nothing, which is how a boundary check can be green against a dead rule.
  for (const [cat, list] of Object.entries(PROBES)) {
    if (!shipped.includes(cat)) continue;
    assert.ok(list.length > 0, `VACUOUS: no probes for rule "${cat}"`);
    for (const p of list) {
      assert.ok(vitals(p).length > 0, `VACUOUS: probe does not fire — "${p}" (rule ${cat})`);
    }
  }
});

// ── 2 · Spelling coverage ────────────────────────────────────────────────────
// Parse the top-level alternation out of each rule's pattern and require every
// alternative to be exercised. A new keyword spelling added without a probe is
// a hole exactly the size of the one `t°?` opened; this closes it. Unparseable
// input throws — fail-closed, never silently zero.

function keywordAlternatives(source: string): string[] {
  assert.ok(
    source.startsWith('(?:'),
    `cannot read keyword group — pattern does not open with a non-capturing group: ${source.slice(0, 40)}`,
  );
  let depth = 0;
  let end = -1;
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.ok(end > 0, `cannot read keyword group — unbalanced parentheses in: ${source.slice(0, 60)}`);

  const body = source.slice(3, end);
  const parts: string[] = [];
  let buf = '';
  depth = 0;
  inClass = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') {
      buf += c + (body[i + 1] ?? '');
      i++;
      continue;
    }
    if (!inClass && c === '[') inClass = true;
    else if (inClass && c === ']') inClass = false;
    else if (!inClass && c === '(') depth++;
    else if (!inClass && c === ')') depth--;
    else if (!inClass && depth === 0 && c === '|') {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  parts.push(buf);
  const nonEmpty = parts.filter((p) => p.length > 0);
  assert.ok(nonEmpty.length > 0, `VACUOUS: keyword group parsed to zero alternatives: ${source}`);
  return nonEmpty;
}

test('every keyword spelling in every rule is exercised by a probe', () => {
  let alternativesChecked = 0;
  for (const rule of VITAL_RULES) {
    const probes = PROBES[rule.category] ?? [];
    for (const alt of keywordAlternatives(rule.pattern.source)) {
      alternativesChecked++;
      const anchored = new RegExp('^(?:' + alt + ')', 'iu');
      const hit = probes.some((p) => anchored.test(p));
      assert.ok(
        hit,
        `keyword spelling /${alt}/ of rule "${rule.category}" is exercised by no probe — ` +
          'add one to PROBES, or the boundary for that spelling is untested',
      );
    }
  }
  assert.ok(alternativesChecked >= 20, `VACUOUS: only ${alternativesChecked} spellings checked`);
});

// ── 3 · The boundary ─────────────────────────────────────────────────────────

// The two strings from the triage, verbatim.
test('a haematology line produces no vital marks', () => {
  const line = 'ПКК: Hb 138 g/l, Hct 42%, PLT 245, Leu 6.4';
  assert.deepStrictEqual(
    vitals(line).map((m) => `${m.label}: ${m.message}`),
    [],
    'the `t` of `t°?` matched inside Hct — a normal haematocrit read as 42°C',
  );
});

test('a multi-analyte lab line produces no vital marks', () => {
  const line = 'Изследвания: PLT 210, Hct 44, ALT 30, GGT 26, Ht 41';
  assert.deepStrictEqual(
    vitals(line).map((m) => `${m.label}: ${m.message}`),
    [],
    'four normal lab values previously rendered as four red clinical criticals',
  );
});

// The positive control the fix must not cost.
test('a real temperature still marks', () => {
  const marks = vitals('t 37.8');
  assert.strictEqual(marks.length, 1, 'the positive control stopped firing');
  assert.strictEqual(marks[0].kind, 'vital-warn');
  assert.strictEqual(marks[0].label, 'Температура');
  assert.match(marks[0].message, /Фебрилитет/);
});

// The negative control that was already clean and must stay clean.
test('normal vitals produce no marks', () => {
  assert.deepStrictEqual(vitals('RR 120/80, ЧСС 72').map((m) => m.raw), []);
});

// The sibling defect Step 0 turned up: `АН` is the tail of every sartan, and
// the dose separator `-` is one of the rule's own systolic/diastolic separators.
test('an antihypertensive dose range is not a blood pressure', () => {
  for (const line of [
    'Лозартан 25-100 мг дневно',
    'Валсартан 80-160 мг веднъж дневно',
    'Телмисартан 40-80 мг',
    'Ирбесартан 150-300 мг',
    'Кандесартан 16-32 мг',
  ]) {
    assert.deepStrictEqual(
      vitals(line).map((m) => `${m.label}: ${m.raw}`),
      [],
      `дозов диапазон прочетен като кръвно налягане: ${line}`,
    );
  }
});

test('a real blood pressure still marks, in both spellings', () => {
  for (const line of ['RR: 155/95 mmHg', 'Кръвно 155 на 95']) {
    const marks = vitals(line);
    assert.strictEqual(marks.length, 1, `blood pressure stopped firing: ${line}`);
    assert.strictEqual(marks[0].label, 'Кръвно налягане');
  }
});

// A real, whole vitals line in the shape the notes carry it.
test('the shipped обективно vitals line marks exactly its abnormal values', () => {
  const line = 'RR: 160/95 mmHg | ЧСС: 106 уд/мин | t°: 37.1°C | SpO2: 88% | ДЧ: 24/мин';
  const marks = vitals(line);
  assert.deepStrictEqual(
    marks.map((m) => m.label),
    ['Кръвно налягане', 'Сърдечна честота', 'Сатурация'],
    'a real vitals line lost or gained a mark',
  );
  assert.strictEqual(marks[2].kind, 'vital-critical');
});

// ── The invariant, swept ─────────────────────────────────────────────────────
// Built over the COMMITTED lab lexicon (lib/lab-lexicon.json, auto-generated
// from the backend's LAB_ENTRIES) so the sweep grows with the vocabulary.
//
// ⚠ BUT THE LEXICON DOES NOT CONTAIN THE VOCABULARY THAT CAUSED THE BUG. Its 38
// labels include none of Hct, PLT, Hb, Leu, Ht, or Latin GGT — every
// abbreviation in the triage. Claiming the sweep „grows with the vocabulary
// instead of with this file" was true and beside the point: all of its purchase
// on THIS defect came from two lines appended at the end. So the haematology
// abbreviations are written out below, declared as what they are — a hardcoded
// list — rather than left to a lexicon that does not carry them.

function labLexiconLabels(): string[] {
  const raw = readFileSync(path.join(REPO, 'lib', 'lab-lexicon.json'), 'utf8');
  const labels = (JSON.parse(raw).entries as Array<{ label: string }>).map((e) => e.label);
  assert.ok(labels.length > 0, 'VACUOUS: lab lexicon resolved to zero labels');
  return labels;
}

const RESULT_VALUES = ['12', '26', '30', '41', '42', '44', '88', '138', '245', '6.4', '2.30'];

// HARDCODED, and named as such: the abbreviations a Bulgarian lab report prints
// that the committed lexicon does not carry. Every one contains a letter some
// rule's keyword alternation can match — that is the whole class.
const REPORT_ABBREVIATIONS = [
  'Hb', 'Hct', 'Ht', 'PLT', 'Leu', 'Er', 'MCV', 'MCH', 'RDW', 'WBC', 'RBC',
  'ALT', 'AST', 'GGT', 'ALP', 'LDH', 'CK', 'CK-MB', 'aPTT', 'PT', 'INR',
  'Na', 'K', 'Cl', 'Ca', 'Mg', 'P', 'Fe', 'TSH', 'FT4', 'FT3', 'CRP', 'ESR',
  'Trop T', 'Tn T', 'cTnT', 'NT-proBNP', 'HbA1c', 'eGFR', 'ЧСС-вариабилност',
];

function sweepCorpus(): string[] {
  const labels = [...labLexiconLabels(), ...REPORT_ABBREVIATIONS];
  const lines: string[] = [];
  for (const l of labels) for (const v of RESULT_VALUES) lines.push(`Изследвания: ${l} ${v}`);
  for (let i = 0; i < labels.length; i += 4) {
    const grp = labels.slice(i, i + 4);
    lines.push('ПКК: ' + grp.map((l, k) => `${l} ${RESULT_VALUES[(i + k) % RESULT_VALUES.length]}`).join(', '));
  }
  // Every probe, and every probe glued to a preceding letter or digit.
  for (const list of Object.values(PROBES)) {
    for (const p of list) {
      lines.push(p);
      for (const pre of ['X', 'ж', '7', 'Hc', 'Лозарт']) lines.push(pre + p);
    }
  }
  lines.push('ПКК: Hb 138 g/l, Hct 42%, PLT 245, Leu 6.4');
  lines.push('Изследвания: PLT 210, Hct 44, ALT 30, GGT 26, Ht 41');
  assert.ok(lines.length > 100, `VACUOUS: sweep corpus is only ${lines.length} lines`);
  return lines;
}

// ── KNOWN false positives, pinned rather than hidden ─────────────────────────
// Standing rule (CLAUDE.md): „known false-positive modes stay in the fixture
// list as permanent expected reds, because an undocumented FP mode gets believed
// when it should be checked."
//
// TROPONIN T. The left boundary fixed `t` INSIDE a word (Hct, PLT, ALT). It does
// nothing for `t` at the START of one — and a standalone Latin `T` is a whole
// lab name. „Тропонин T 45 ng/l" renders as vital-critical Висока температура,
// and the collision is exact: troponin T's actionable ACS band is 25–45 ng/L and
// the temperature rule's plausibility band is 25–45 °C. Nothing lexical
// separates „T 45" from the brief's own positive control „t 37.8" — only the
// value does, and the values overlap.
//
// NOT FIXED HERE, deliberately. Requiring the degree sign would kill „t 37.8";
// excluding a list of lab prefixes is the denylist-of-spellings shape a refuter
// would drive straight through; and a preceding-token context test is a NEW
// MECHANISM, not the boundary fix this change is scoped to. It needs a ruling.
// The Cyrillic spelling „Тропонин Т 45" does NOT fire (`т°` requires the degree
// sign), so the exposure is Latin `T` — which is what lab printouts use.
const KNOWN_FP_LAB = ['Trop T', 'Tn T'];

test('KNOWN residual: a standalone Latin T before a 2-digit value still marks', () => {
  // Asserted as CURRENT behaviour so that fixing it goes red on purpose and
  // forces this comment to be updated with the ruling.
  const marks = vitals('Тропонин T 45 ng/l (реф. < 14)');
  assert.strictEqual(marks.length, 1, 'the residual changed — re-read the ruling above');
  assert.strictEqual(marks[0].kind, 'vital-critical');
  assert.strictEqual(marks[0].label, 'Температура');
  // The Cyrillic spelling is clean, and that asymmetry is the whole exposure.
  assert.deepStrictEqual(vitals('Тропонин Т 45 ng/l').map((m) => m.raw), []);
});

test('KNOWN residual: a stated RANGE is consumed as a measurement', () => {
  // „Целева сатурация 88-92%" is the textbook COPD target; writing the PLAN
  // renders a red hypoxaemia critical. Same shape on „RR 12-20/мин" (RR is
  // Riva-Rocci here but respiratory rate internationally, and `-` is one of the
  // BP rule's own systolic/diastolic separators). A right-hand range test would
  // close both, but it is a new mechanism and it collides with the BP rule,
  // where `160-95` IS a legitimate reading. Ruling owed.
  const sat = vitals('Целева сатурация 88-92% при ХОББ.');
  assert.strictEqual(sat.length, 1);
  assert.strictEqual(sat[0].kind, 'vital-critical');
  const rr = vitals('RR 12-20/мин');
  assert.strictEqual(rr.length, 1);
  assert.match(rr[0].message, /Невалидна стойност/);
});

test('no lab-result line built from the lexicon or the report abbreviations marks', () => {
  const offenders: string[] = [];
  let pinnedSeen = 0;
  for (const line of sweepCorpus()) {
    // Probe lines are meant to fire; the lab lines are not.
    if (!line.startsWith('Изследвания: ') && !line.startsWith('ПКК: ')) continue;
    if (KNOWN_FP_LAB.some((k) => line.includes(k))) { pinnedSeen++; continue; }
    for (const m of vitals(line)) offenders.push(`«${m.raw}» ${m.kind} ${m.label} — in: ${line}`);
  }
  // The exclusion must not silently cover nothing — if the pinned shapes stop
  // appearing in the corpus, the pin has become decoration.
  assert.ok(pinnedSeen > 0, 'VACUOUS: the KNOWN_FP exclusion matched no line at all');
  assert.deepStrictEqual(offenders, [], `spurious vital marks on lab-result lines:\n  ${offenders.join('\n  ')}`);
});

test('every mark ever returned begins at a word start', () => {
  const offenders: string[] = [];
  let marksSeen = 0;
  for (const line of sweepCorpus()) {
    for (const m of vitals(line)) {
      marksSeen++;
      if (!beginsAtWordStart(line, m.start)) {
        offenders.push(`«${m.raw}» at ${m.start} after "${line[m.start - 1]}" — in: ${line}`);
      }
    }
  }
  assert.ok(marksSeen > 0, 'VACUOUS: the sweep produced no marks at all, so it checked nothing');
  assert.deepStrictEqual(
    offenders,
    [],
    `mark(s) beginning mid-word — the left boundary is gone:\n  ${offenders.join('\n  ')}`,
  );
});

// ── 3b · The layers a refuter walked through ─────────────────────────────────
// 29 mutations were applied to the real lib/vital-rules.ts and run against this
// gate; 14 passed, 12 of them changing real behaviour. Each test below closes
// one of the families that got through.

test('a rejected candidate does not stop the rule for the rest of the text', () => {
  // FIRST-OCCURRENCE. Changing `continue` to `break` in findVitalMatches passed
  // all 12 tests and the whole 465-test suite, because every probe and every
  // threshold case put the keyword at index 0 with nothing rejected before it —
  // and the two lines that DO contain rejected candidates assert ZERO marks,
  // which `break` also satisfies. A real fever after a lab value went silent.
  for (const [line, expect] of [
    ['PLT 245, t 39.5', 'Висока температура'],
    ['ALT 30, AST 26, GGT 26, t 40.1', 'Висока температура'],
    ['Изследвания: Hct 42, PLT 245. Обективно: ЧСС 132', 'Тежка тахикардия'],
  ] as Array<[string, string]>) {
    const marks = vitals(line);
    assert.strictEqual(marks.length, 1, `no mark after a rejected candidate: "${line}"`);
    assert.match(marks[0].message, new RegExp(expect));
  }
});

test('the boundary is the complement of a word char, not a list of separators', () => {
  // PARTITION SOLD AS A BOUNDARY. Replacing the predicate with an allowlist
  // /[\s.,;:()%|]/ passed all 12 tests, because every probe preceded its keyword
  // with a space, a colon or a pipe. Clinical text is punctuated by more.
  for (const line of ['**t 38.5**', '—t 38.5', '«АН 185/115»', '·ЧСС 112', '(t 38.5)', '„t 38.5"', '\u2013t 38.5']) {
    assert.ok(vitals(line).length > 0, `a real vital stopped marking after punctuation: "${line}"`);
  }
});

test('the boundary holds on a long note, far from index 0', () => {
  // DISABLED CONTROL. `if (text.length < 200 && !startsAtWordStart(...))` and
  // `if (m.index < 100 && ...)` both passed all 12 tests: the gate's longest
  // string was 73 chars and its largest match index under 60.
  const prefix =
    'Обективно състояние: общото състояние е добро, съзнанието ясно, ориентиран за време и място, ' +
    'кожа и видими лигавици с обичаен цвят, без периферни отоци, дишането е чисто везикуларно ' +
    'двустранно без хрипове, сърдечната дейност ритмична. ';
  assert.ok(prefix.length > 200, 'the long-note prefix is no longer long');
  assert.deepStrictEqual(
    vitals(prefix + 'ПКК: Hb 138 g/l, Hct 42%, PLT 245, Leu 6.4').map((m) => m.raw),
    [],
    'the boundary is length-gated — it stops applying on a real-length note',
  );
  assert.deepStrictEqual(
    vitals(prefix + 'Лозартан 25-100 мг дневно').map((m) => m.raw),
    [],
    'the boundary is index-gated — it stops applying past a real-length prefix',
  );
  // …and a real vital that far in must still mark.
  assert.strictEqual(vitals(prefix + 't 39.5').length, 1);
});

test('the captured value has a right boundary — a longer number is not truncated', () => {
  // Every quantifier is left-anchored, so "ДЧ 112" was read as «ДЧ 11» →
  // "Брадипнея", inverting the clinical direction of a tachypnoea.
  for (const line of ['ДЧ 112', 'ЧД 100', 'ЧСС 1120', 'пулс 1200', 't 385', 'SpO2 1000']) {
    assert.deepStrictEqual(vitals(line).map((m) => m.raw), [], `truncated number still marks: "${line}"`);
  }
  // The whitespace clause is the part that can silently over-scrub: several
  // patterns end in a greedy `\\s*`, so a value followed by a SEPARATE numeric
  // token must still mark. Without these three the check would look correct
  // and quietly delete real fevers.
  assert.strictEqual(vitals('t 38.6 120').length, 1, 'a fever followed by a separate number stopped marking');
  assert.strictEqual(vitals('ЧСС 112 уд/мин').length, 1, 'a real HR with a unit stopped marking');
  assert.strictEqual(vitals('t°: 38,1°C | SpO2: 93%').length, 2, 'a real vitals pair stopped marking');
});

test('the alternations were not widened past what the probes pin', () => {
  // The coverage layer anchors `^(?:<alternative>)` against the probes, so
  // WIDENING an alternative a probe still matches is invisible to it: `t°?` →
  // `[tт]°?` and `HR` → `HR?` both passed. These negative controls pin the
  // current reach directly.
  assert.deepStrictEqual(vitals('т 38.5').map((m) => m.raw), [], 'bare Cyrillic т without ° now marks');
  assert.deepStrictEqual(vitals('H 138').map((m) => m.raw), [], 'bare H now marks as a heart rate');
  assert.deepStrictEqual(vitals('155/95').map((m) => m.raw), [], 'a bare ratio now marks as a blood pressure');
  assert.deepStrictEqual(vitals('R 155/95').map((m) => m.raw), [], 'a single R now marks as a blood pressure');
});

test('the boundary holds under NODE_ENV=production — the one config CI never sets', () => {
  // DISABLED CONTROL, the env variant:
  //   if (process.env.NODE_ENV !== 'production' && !startsAtWordStart(...))
  // passed all 12 tests, because nothing here ever set NODE_ENV — so the gate
  // was green in CI and the defect was back on every string in the deployed
  // build. This repo has the shape on file already: the RETAIN_AUDIO_BLOBS boot
  // guard tested `NODE_ENV === 'production'` while NOTHING in either repo or
  // Railway ever sets NODE_ENV, so the lock was inert in prod for months.
  //
  // Run in a CHILD process, because the module is already imported here and a
  // later process.env write would not re-evaluate it.
  const probe = [
    "const { findHighlights } = await import(process.argv[1]);",
    "const v = (s) => findHighlights(s).filter((h) => h.kind.startsWith('vital-'));",
    "const bad = [];",
    "if (v('ПКК: Hb 138 g/l, Hct 42%, PLT 245, Leu 6.4').length) bad.push('haematology line marks');",
    "if (v('Изследвания: PLT 210, Hct 44, ALT 30, GGT 26, Ht 41').length) bad.push('lab line marks');",
    "if (v('Лозартан 25-100 мг дневно').length) bad.push('sartan dose range marks');",
    "if (v('ДЧ 112').length) bad.push('truncated number marks');",
    "if (v('t 37.8').length !== 1) bad.push('positive control stopped marking');",
    "if (v('RR 120/80, ЧСС 72').length) bad.push('negative control marks');",
    "console.log(bad.join(' | '));",
    "process.exit(bad.length ? 1 : 0);",
  ].join('\n');

  const modUrl = new URL('../lib/vital-rules.ts', import.meta.url).href;
  const res = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', probe, modUrl],
    { env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8' },
  );
  // A harness that could not run is NOT a pass — exit 126/127 is not a verdict.
  assert.ok(
    res.status === 0 || res.status === 1,
    `VACUOUS: the NODE_ENV probe did not run (status ${res.status}): ${res.stderr}`,
  );
  assert.strictEqual(
    res.status,
    0,
    `the boundary behaves differently under NODE_ENV=production: ${res.stdout.trim()}`,
  );
});

// ── 4 · Thresholds ───────────────────────────────────────────────────────────
// One assertion per rule per cut point. The boundary is a single shared
// function; without these, a mutation to any individual classifier would sail
// through a gate that only ever asked about boundaries.

// ⚠ ONE NORMAL EXEMPLAR PER RULE IS A POINT CHECK DRESSED AS AN INTERVAL CHECK.
// The first version of this table carried exactly one normal value per rule, so
// every cut point could be moved to just past it and stay green: a refuter
// pulled the hypertensive-crisis threshold from 180/110 down to 150/92 and
// „RR: 155/95" — a committed baseline value — went from amber Хипертония to the
// reserved medication-safety RED, with all 12 tests passing. Four thresholds
// fell to the same edit. Every cut point now carries BOTH sides of its edge.
const CLASSIFY: Array<[string, string, string | null, RegExp | null]> = [
  // temp — edges at 34 / 35.5 / 37.5 / 39, plausibility band 25–45
  ['t 24.9', 'temp', null, null],
  ['t 25.0', 'temp', 'vital-critical', /Тежка хипотермия/],
  ['t 33.9', 'temp', 'vital-critical', /Тежка хипотермия/],
  ['t 34.0', 'temp', 'vital-warn', /Хипотермия/],
  ['t 35.4', 'temp', 'vital-warn', /Хипотермия/],
  ['t 35.5', 'temp', null, null],
  ['t 36.6', 'temp', null, null],
  ['t 37.5', 'temp', null, null],
  ['t 37.6', 'temp', 'vital-warn', /Фебрилитет/],
  ['t 37.8', 'temp', 'vital-warn', /Фебрилитет/],
  ['t 39.0', 'temp', 'vital-warn', /Фебрилитет/],
  ['t 39.1', 'temp', 'vital-critical', /Висока температура/],
  ['t 45.0', 'temp', 'vital-critical', /Висока температура/],
  ['t 45.1', 'temp', null, null],
  ['t 46.0', 'temp', null, null],
  // bp — data sanity first, then 180/110, 90/60, 140/90
  ['RR 60/90', 'bp', 'vital-critical', /Невалидна стойност/],
  ['RR 120/120', 'bp', 'vital-critical', /Невалидна стойност/],
  ['RR 180/109', 'bp', 'vital-critical', /Хипертонична криза/],
  ['RR 179/110', 'bp', 'vital-critical', /Хипертонична криза/],
  ['RR 179/109', 'bp', 'vital-warn', /Хипертония/],
  ['RR 140/89', 'bp', 'vital-warn', /Хипертония/],
  ['RR 139/90', 'bp', 'vital-warn', /Хипертония/],
  ['RR 139/89', 'bp', null, null],
  ['RR 155/95', 'bp', 'vital-warn', /Хипертония/],  // a committed baseline value
  ['RR 120/80', 'bp', null, null],
  ['RR 90/60', 'bp', null, null],
  ['RR 89/60', 'bp', 'vital-warn', /Хипотония/],
  ['RR 90/59', 'bp', 'vital-warn', /Хипотония/],
  // hr — 40 / 60 / 100 / 130, plausibility band 20–250
  ['ЧСС 39', 'hr', 'vital-critical', /Тежка брадикардия/],
  ['ЧСС 40', 'hr', 'vital-warn', /Брадикардия/],
  ['ЧСС 59', 'hr', 'vital-warn', /Брадикардия/],
  ['ЧСС 60', 'hr', null, null],
  ['ЧСС 72', 'hr', null, null],
  ['ЧСС 88', 'hr', null, null],
  ['ЧСС 100', 'hr', null, null],
  ['ЧСС 101', 'hr', 'vital-warn', /Тахикардия/],
  ['ЧСС 130', 'hr', 'vital-warn', /Тахикардия/],
  ['ЧСС 131', 'hr', 'vital-critical', /Тежка тахикардия/],
  // spo2 — 90 / 95, plausibility band 50–100
  ['SpO2 89', 'spo2', 'vital-critical', /Тежка хипоксемия/],
  ['SpO2 90', 'spo2', 'vital-warn', /Гранична сатурация/],
  ['SpO2 94', 'spo2', 'vital-warn', /Гранична сатурация/],
  ['SpO2 95', 'spo2', null, null],
  ['SpO2 96', 'spo2', null, null],
  ['SpO2 97', 'spo2', null, null],
  // rr — 8 / 12 / 24 / 30, plausibility band 4–60
  ['ДЧ 7', 'rr', 'vital-critical', /Тежка брадипнея/],
  ['ДЧ 8', 'rr', 'vital-warn', /Брадипнея/],
  ['ДЧ 11', 'rr', 'vital-warn', /Брадипнея/],
  ['ДЧ 12', 'rr', null, null],
  ['ДЧ 16', 'rr', null, null],
  ['ДЧ 24', 'rr', null, null],
  ['ДЧ 25', 'rr', 'vital-warn', /Тахипнея/],
  ['ДЧ 30', 'rr', 'vital-warn', /Тахипнея/],
  ['ДЧ 31', 'rr', 'vital-critical', /Тежка тахипнея/],
];

test('every rule classifies at its documented cut points', () => {
  const covered = new Set(CLASSIFY.map(([, cat]) => cat));
  for (const rule of VITAL_RULES) {
    assert.ok(covered.has(rule.category), `rule "${rule.category}" has no threshold case`);
  }
  for (const [text, cat, kind, message] of CLASSIFY) {
    const marks = vitals(text);
    if (kind === null) {
      assert.deepStrictEqual(marks.map((m) => m.raw), [], `${cat}: "${text}" should be unmarked`);
      continue;
    }
    assert.strictEqual(marks.length, 1, `${cat}: "${text}" produced ${marks.length} marks, expected 1`);
    assert.strictEqual(marks[0].kind, kind, `${cat}: "${text}" wrong severity`);
    assert.match(marks[0].message, message as RegExp, `${cat}: "${text}" wrong message`);
  }
});
