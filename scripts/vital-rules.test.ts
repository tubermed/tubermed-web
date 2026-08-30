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
// from the backend's LAB_ENTRIES) rather than a list typed here, so the sweep
// grows with the vocabulary instead of with this file.

function labLexiconLabels(): string[] {
  const raw = readFileSync(path.join(REPO, 'lib', 'lab-lexicon.json'), 'utf8');
  const labels = (JSON.parse(raw).entries as Array<{ label: string }>).map((e) => e.label);
  assert.ok(labels.length > 0, 'VACUOUS: lab lexicon resolved to zero labels');
  return labels;
}

const RESULT_VALUES = ['12', '26', '30', '41', '42', '44', '88', '138', '245', '6.4', '2.30'];

function sweepCorpus(): string[] {
  const labels = labLexiconLabels();
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

test('no lab-result line built from the committed lexicon produces a vital mark', () => {
  const offenders: string[] = [];
  for (const line of sweepCorpus()) {
    // Probe lines are meant to fire; the lexicon lines are not.
    if (!line.startsWith('Изследвания: ') && !line.startsWith('ПКК: ')) continue;
    for (const m of vitals(line)) offenders.push(`«${m.raw}» ${m.kind} ${m.label} — in: ${line}`);
  }
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

// ── 4 · Thresholds ───────────────────────────────────────────────────────────
// One assertion per rule per cut point. The boundary is a single shared
// function; without these, a mutation to any individual classifier would sail
// through a gate that only ever asked about boundaries.

const CLASSIFY: Array<[string, string, string | null, RegExp | null]> = [
  ['t 33.0', 'temp', 'vital-critical', /Тежка хипотермия/],
  ['t 35.0', 'temp', 'vital-warn', /Хипотермия/],
  ['t 36.6', 'temp', null, null],
  ['t 37.8', 'temp', 'vital-warn', /Фебрилитет/],
  ['t 39.5', 'temp', 'vital-critical', /Висока температура/],
  ['t 46.0', 'temp', null, null], // out of physiological range → not a temperature
  ['RR 60/90', 'bp', 'vital-critical', /Невалидна стойност/],
  ['RR 185/95', 'bp', 'vital-critical', /Хипертонична криза/],
  ['RR 145/88', 'bp', 'vital-warn', /Хипертония/],
  ['RR 85/55', 'bp', 'vital-warn', /Хипотония/],
  ['RR 120/80', 'bp', null, null],
  ['ЧСС 38', 'hr', 'vital-critical', /Тежка брадикардия/],
  ['ЧСС 52', 'hr', 'vital-warn', /Брадикардия/],
  ['ЧСС 72', 'hr', null, null],
  ['ЧСС 112', 'hr', 'vital-warn', /Тахикардия/],
  ['ЧСС 142', 'hr', 'vital-critical', /Тежка тахикардия/],
  ['SpO2 88', 'spo2', 'vital-critical', /Тежка хипоксемия/],
  ['SpO2 93', 'spo2', 'vital-warn', /Гранична сатурация/],
  ['SpO2 97', 'spo2', null, null],
  ['ДЧ 6', 'rr', 'vital-critical', /Тежка брадипнея/],
  ['ДЧ 10', 'rr', 'vital-warn', /Брадипнея/],
  ['ДЧ 16', 'rr', null, null],
  ['ДЧ 28', 'rr', 'vital-warn', /Тахипнея/],
  ['ДЧ 34', 'rr', 'vital-critical', /Тежка тахипнея/],
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
