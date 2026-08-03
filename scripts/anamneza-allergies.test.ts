// ─────────────────────────────────────────────────────────────────────────────
// Allergies are folded into АНАМНЕЗА on the exported лист — and an empty list
// prints nothing at all.
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm run test   (node --test, Node 24 strips the types natively.)
//
// The амбулаторен лист has no allergy field, so `alergii` was extracted from day
// one and exported by nothing. Анамнеза is where an allergy history legally
// belongs and where the on-screen section already sits, so that is where it
// lands — appended, never merged into the doctor's dictated text.
//
// The assertion that matters most here is the NEGATIVE one: an empty `alergii`
// array must render NOTHING, not "Няма известни алергии". An empty array means
// nothing was extracted; it is not a recorded denial. Printing one would put a
// clinical claim on a document with материална доказателствена сила that the
// visit may never have established — the same reasoning that removed the
// „няма открити рискове" empty state from the alerts surface (2026-08-01).
// That is the kind of rule a later "improvement" silently reverses, so it is
// pinned in all three exporters rather than described in a comment.
//
// registerHooks note: same local sync resolve hook as the sibling exporter
// tests — lib/exporters.ts uses extensionless relative imports.

import { test } from 'node:test';
import assert from 'node:assert';
import Module from 'node:module';
import type { TranscribeFields } from '../lib/types.ts';

type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = Module as unknown as {
  registerHooks: (hooks: {
    resolve: (specifier: string, context: unknown, nextResolve: NextResolve) => unknown;
  }) => void;
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !specifier.endsWith('.ts')) {
        return nextResolve(specifier + '.ts', context);
      }
      throw err;
    }
  },
});

const { formatPlainText, generatePdfHtml, generateWordHtml, anamnezaSectionText } =
  await import('../lib/exporters.ts');

const DATE = '03.08.2026';
const NARRATIVE = 'Пациентът съобщава кашлица от три дни.';

function fields(over: Partial<TranscribeFields> = {}): TranscribeFields {
  return {
    anamneza: NARRATIVE,
    obektivno: 'RR: 130/80 mmHg | ЧСС: 72 уд/мин | t°: 36.6°C | SpO2: 98% | ДЧ: 16/мин',
    osnovna_diagnoza: 'Остър бронхит',
    osnovna_mkb: 'J20.9',
    ...over,
  } as TranscribeFields;
}

const renderers: Array<[string, (f: TranscribeFields) => string]> = [
  ['formatPlainText', (f) => formatPlainText(f)],
  ['generatePdfHtml', (f) => generatePdfHtml(f, DATE)],
  ['generateWordHtml', (f) => generateWordHtml(f, DATE)],
];

// ── the helper itself ───────────────────────────────────────────────────────

test('allergens are appended after the narrative, which is left untouched', () => {
  const out = anamnezaSectionText(fields({ alergii: ['пеницилин', 'аспирин'] }));
  assert.ok(out.startsWith(NARRATIVE), 'the dictated narrative must lead and be unmodified');
  assert.ok(out.includes('Алергии: пеницилин, аспирин'));
});

test('an empty allergy list leaves анамнеза byte-identical', () => {
  assert.strictEqual(anamnezaSectionText(fields({ alergii: [] })), NARRATIVE);
  assert.strictEqual(anamnezaSectionText(fields()), NARRATIVE);
});

test('allergens survive an empty анамнеза rather than being lost with it', () => {
  const out = anamnezaSectionText(fields({ anamneza: '', alergii: ['пеницилин'] }));
  assert.strictEqual(out, 'Алергии: пеницилин');
});

test('blank and non-string allergen entries are dropped, not printed', () => {
  const out = anamnezaSectionText(
    fields({ alergii: ['пеницилин', '', '   ', null as unknown as string, 'аспирин'] }),
  );
  assert.strictEqual(out, `${NARRATIVE}\n\nАлергии: пеницилин, аспирин`);
});

// ── all three exporters ─────────────────────────────────────────────────────

for (const [name, render] of renderers) {
  test(`${name}: allergens reach the document`, () => {
    const out = render(fields({ alergii: ['пеницилин', 'аспирин'] }));
    assert.ok(out.includes('пеницилин'), `${name} dropped the allergen`);
    assert.ok(out.includes('аспирин'), `${name} dropped the second allergen`);
  });

  test(`${name}: allergens ride in АНАМНЕЗА, not a section of their own`, () => {
    const out = render(fields({ alergii: ['пеницилин'] }));
    const headings = (out.match(/Алергии/gi) || []).length;
    assert.strictEqual(
      headings, 1,
      `${name} emitted ${headings} "Алергии" occurrences — expected exactly the one ` +
        `inline label. A second one means it grew a section the официалният лист does not have.`,
    );
  });

  test(`${name}: an empty list prints no allergy line and NO denial`, () => {
    const out = render(fields({ alergii: [] }));
    assert.ok(!/Алерги/i.test(out), `${name} printed an allergy line for an empty list`);
    assert.ok(
      !/няма\s+(известни|данни|регистрирани)?\s*алерг/i.test(out),
      `${name} manufactured a denial — an empty array is not a recorded denial`,
    );
  });

  test(`${name}: omitting alergii entirely renders as before`, () => {
    assert.strictEqual(
      render(fields()),
      render(fields({ alergii: [] })),
      `${name}: an absent alergii key and an empty one must be indistinguishable`,
    );
  });
}
