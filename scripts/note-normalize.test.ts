// ─────────────────────────────────────────────────────────────────────────────
// note-normalize — the read boundary, and the seatbelt behind it
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm test   (node --test, Node 24 strips the types natively.)
//
// On 2026-08-08 the result page died whole on `_.izsledvania.trim is not a
// function`. `izsledvania` was `[]`; the page's guard was
// `fields.izsledvania && fields.izsledvania.trim()`, and `[]` is TRUTHY, so the
// guard passed it to a `.trim` that does not exist on an array. One field cost
// the doctor the entire консултация — every other section, the diagnosis, the
// transcript, the export buttons.
//
// The backend now types the note at the write boundary, so new notes are clean.
// These cases are for the 9 rows already in the database, the oldest from
// 2026-05-18. Four of them are approved or sealed and can never be rewritten
// (/edit answers 409 `note_sealed`, no unlock, by design), so the read boundary
// is the only place they can be made readable at all.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeNoteFields, lossyRepairs, asText, asList } from '../lib/note-normalize.ts';
import type { TranscribeFields } from '../lib/types.ts';

// The exact shape of live row 4b86f124.
const CRASHING_ROW = {
  anamneza: 'Пациент на 54 г. с главоболие от три дни.',
  alergii: [],
  obektivno: 'RR: 130/85 mmHg | ЧСС: 72 уд/мин',
  izsledvania: [] as unknown as string,
  terapia: 'Парацетамол 500 мг при болка',
  medications_list: [],
  osnovna_diagnoza: 'Главоболие',
  osnovna_mkb: 'R51',
  pridruzhavashti: [],
  napravlenia: '',
  naznacheni: '',
  uncertain_spans: [],
} as unknown as TranscribeFields;

test('the live crash: izsledvania [] becomes a string the page can .trim()', () => {
  const { fields } = normalizeNoteFields(CRASHING_ROW);
  assert.strictEqual(typeof fields.izsledvania, 'string');
  assert.doesNotThrow(() => (fields.izsledvania as string).trim());
  // The page's own guard, verbatim from page.tsx:1485.
  assert.doesNotThrow(() => !!(fields.izsledvania && fields.izsledvania.trim()));
});

test('every other section of the crashing row survives untouched', () => {
  const { fields } = normalizeNoteFields(CRASHING_ROW);
  assert.strictEqual(fields.anamneza, CRASHING_ROW.anamneza);
  assert.strictEqual(fields.obektivno, CRASHING_ROW.obektivno);
  assert.strictEqual(fields.terapia, CRASHING_ROW.terapia);
  assert.strictEqual(fields.osnovna_diagnoza, 'Главоболие');
  assert.strictEqual(fields.osnovna_mkb, 'R51');
});

test('a lossless repair puts NO problem marker on the note', () => {
  const { repairs } = normalizeNoteFields(CRASHING_ROW);
  assert.strictEqual(repairs.length, 1, 'the repair is reported to the caller');
  assert.deepStrictEqual(lossyRepairs(repairs), [],
    'nothing was lost, so the doctor is shown nothing — a note that flags itself for nothing gets ignored');
});

test('the `|| \'\'` idiom this replaced does NOT handle the case — the reason it exists', () => {
  // Held as `unknown` so tsc cannot narrow them away — which is the point: the
  // compiler could not see this defect either, because the declared types were
  // not wrong about themselves, they were wrong about the runtime.
  const emptyArray: unknown = [];
  const bareString: unknown = 'пеницилин';
  const absent: unknown = null;

  // Exactly what every reader in this repo does today.
  assert.throws(() => ((emptyArray || '') as string).trim(), TypeError);
  assert.throws(() => ((bareString || []) as string[]).forEach(() => {}), TypeError);
  // …and what it is actually good for: null/undefined, and nothing else.
  assert.doesNotThrow(() => ((absent || '') as string).trim());
});

test('content is never coerced away — a wrong-typed narrative field keeps its text', () => {
  const { fields } = normalizeNoteFields({
    naznacheni: ['ПКК', 'СУЕ'],
    izsledvania: ['Хемоглобин 138 g/L'],
  } as unknown as TranscribeFields);
  assert.ok(fields.naznacheni?.includes('ПКК'), 'a dictated test order was destroyed');
  assert.ok(fields.naznacheni?.includes('СУЕ'));
  assert.ok(fields.izsledvania?.includes('Хемоглобин 138 g/L'));
});

test('prose fed to a row-array is quarantined, never minted into a row', () => {
  const { fields, repairs } = normalizeNoteFields({
    medications_list: 'парацетамол 500 мг три пъти дневно',
  } as unknown as TranscribeFields);
  const meds = fields.medications_list;
  assert.ok(Array.isArray(meds), 'readers must get a real array');
  // No { inn: <a whole sentence> } to feed drug-safety and the exports.
  assert.strictEqual(meds.length, 0, 'a row was invented from prose');
  const lossy = lossyRepairs(repairs);
  assert.strictEqual(lossy.length, 1);
  assert.strictEqual(lossy[0].text, 'парацетамол 500 мг три пъти дневно',
    'the doctor said it — it has to survive somewhere they can see it');
});

test('alergii takes a bare string — a string array can hold it faithfully', () => {
  const { fields, repairs } = normalizeNoteFields({ alergii: 'пеницилин' } as unknown as TranscribeFields);
  assert.deepStrictEqual(fields.alergii, ['пеницилин']);
  assert.deepStrictEqual(lossyRepairs(repairs), [], 'a faithful recovery is not a loss');
});

test('an unwrapped comorbidity ROW is promoted — that invents nothing', () => {
  const { fields } = normalizeNoteFields({
    pridruzhavashti: { diagnoza: 'Хипертония', mkb: 'I10' },
  } as unknown as TranscribeFields);
  assert.deepStrictEqual(fields.pridruzhavashti, [{ diagnoza: 'Хипертония', mkb: 'I10' }]);
});

test('absent keys stay absent — izsledvania_blocks ABSENT is the no-blocks sentinel', () => {
  const { fields } = normalizeNoteFields({ anamneza: 'x' } as TranscribeFields);
  assert.ok(!('izsledvania_blocks' in fields),
    'manufacturing [] would change the shape of every legacy row');
});

test('an echo лист passes through untouched — it carries none of these keys', () => {
  const echo = { lv_edd: '48', conclusion: 'Норма' } as unknown as TranscribeFields;
  const { fields, repairs } = normalizeNoteFields(echo);
  assert.deepStrictEqual(fields, echo);
  assert.deepStrictEqual(repairs, []);
});

test('normalizeNoteFields never throws, whatever it is handed', () => {
  for (const junk of [null, undefined, 'str', 42, [], true, { a: 1 }]) {
    assert.doesNotThrow(() => normalizeNoteFields(junk as unknown as TranscribeFields));
  }
});

// ── The readers' helpers ────────────────────────────────────────────────────
test('asText and asList absorb every shape without throwing', () => {
  assert.strictEqual(asText([]), '');
  assert.strictEqual(asText(['a', 'b']), 'a\nb');
  assert.strictEqual(asText(null), '');
  assert.strictEqual(asText('x'), 'x');
  assert.deepStrictEqual(asList('x'), []);          // no row minted from prose
  assert.deepStrictEqual(asList({ a: 1 }), [{ a: 1 }]);
  assert.deepStrictEqual(asList(null), []);
  assert.deepStrictEqual(asList(['a']), ['a']);
});

// ── The seatbelt: one bad field must not take the page ──────────────────────
// The боundary is a React class component, so what is asserted here is the
// contract it relies on — a section render that throws is CONTAINED, and the
// note object handed to its siblings is unaffected. The live render is verified
// in the browser (see the session report); this pins the data half.
test('a corrupt field cannot reach a sibling section', () => {
  const corrupt = {
    anamneza: 'Анамнеза текст',
    obektivno: 'Обективно текст',
    izsledvania: { unexpected: 'object' } as unknown as string,
    terapia: 'Терапия текст',
    osnovna_diagnoza: 'Диагноза',
  } as unknown as TranscribeFields;

  const { fields, repairs } = normalizeNoteFields(corrupt);
  // The bad field is renderable…
  assert.strictEqual(typeof fields.izsledvania, 'string');
  // …it is MARKED…
  assert.ok(repairs.some((r) => r.field === 'izsledvania'));
  // …and every sibling is byte-identical.
  assert.strictEqual(fields.anamneza, 'Анамнеза текст');
  assert.strictEqual(fields.obektivno, 'Обективно текст');
  assert.strictEqual(fields.terapia, 'Терапия текст');
  assert.strictEqual(fields.osnovna_diagnoza, 'Диагноза');
});
