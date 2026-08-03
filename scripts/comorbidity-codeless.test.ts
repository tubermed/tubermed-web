// ─────────────────────────────────────────────────────────────────────────────
// A comorbidity with NO МКБ code must render as a coded row minus the code —
// never as the literal string "undefined" on a filed document.
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm run test   (node --test, Node 24 strips the types natively.)
//
// WHY THIS FILE EXISTS. The backend strips an invalid comorbidity code by
// DELETING the key (`delete entry.mkb`, lib/process-audio.js validateMkbCodes
// and G6) rather than blanking it to ''. Absent means "this comorbidity has no
// code"; '' would mean "a code field that is blank", and only the first is true.
//
// The cost of getting the reader side wrong is asymmetric and one-way: the
// амбулаторен лист is a document with материална доказателствена сила, so a
// literal "undefined" in the МКБ column is not a cosmetic slip — it is a false
// statement on a signed record, and by the time it renders the note may already
// be sealed. Every exporter below is therefore pinned against BOTH shapes:
// absent key and empty string must produce byte-identical output, so the
// backend can move between them without a frontend release.
//
// registerHooks note: lib/exporters.ts sits in an import graph that uses
// extensionless relative imports (the app bundler resolves them; plain
// `node --test` cannot). Same local sync resolve hook as
// exporters-section-text.test.ts — no app code or tsconfig change.

import { test } from 'node:test';
import assert from 'node:assert';
import Module from 'node:module';
import type { TranscribeFields, ComorbidDiagnosis } from '../lib/types.ts';

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

const { formatPlainText, generatePdfHtml, generateWordHtml } =
  await import('../lib/exporters.ts');
const { filedComorbidityTerm } = await import('../lib/diagnosis.ts');

const DATE = '03.08.2026';

// The exact shape validateMkbCodes now emits for a stripped code: the diagnosis
// text survives, `mkb` and the derived `mkb_term` are both gone.
const codeless: ComorbidDiagnosis = { diagnoza: 'Гонартроза' };
// The shape it used to emit. Kept as a control — the two must be indistinguishable
// downstream, which is what makes the backend change safe to ship on its own.
const blanked = { diagnoza: 'Гонартроза', mkb: '' } as ComorbidDiagnosis;

function fieldsWith(co: ComorbidDiagnosis[]): TranscribeFields {
  return {
    anamneza: 'Пациентът съобщава болка в дясното коляно.',
    obektivno: 'RR: 130/80 mmHg | ЧСС: 72 уд/мин | t°: 36.6°C | SpO2: 98% | ДЧ: 16/мин',
    osnovna_diagnoza: 'Есенциална хипертония',
    osnovna_mkb: 'I10',
    pridruzhavashti: co,
  } as TranscribeFields;
}

const renderers: Array<[string, (f: TranscribeFields) => string]> = [
  ['formatPlainText', (f) => formatPlainText(f)],
  ['generatePdfHtml', (f) => generatePdfHtml(f, DATE)],
  ['generateWordHtml', (f) => generateWordHtml(f, DATE)],
];

for (const [name, render] of renderers) {
  test(`${name}: a codeless comorbidity never emits "undefined"`, () => {
    const out = render(fieldsWith([codeless]));
    assert.ok(
      !/undefined/.test(out),
      `${name} leaked "undefined" into export output — a filed лист would carry it`,
    );
  });

  test(`${name}: the codeless comorbidity's TEXT still appears`, () => {
    const out = render(fieldsWith([codeless]));
    assert.ok(
      out.includes('Гонартроза'),
      `${name} dropped the diagnosis text — stripping the code must keep the diagnosis`,
    );
  });

  test(`${name}: absent mkb and mkb:'' render identically`, () => {
    assert.strictEqual(
      render(fieldsWith([codeless])),
      render(fieldsWith([blanked])),
      `${name} distinguishes an absent code from a blank one — the backend cannot ` +
        `then change the shape without a coordinated frontend release`,
    );
  });

  test(`${name}: a codeless comorbidity does not suppress a coded sibling`, () => {
    const out = render(fieldsWith([codeless, { diagnoza: 'Захарен диабет тип 2', mkb: 'E11' }]));
    assert.ok(out.includes('E11'), `${name} lost the sibling's code`);
    assert.ok(out.includes('Гонартроза'), `${name} lost the codeless row`);
  });
}

// filedComorbidityTerm is the shared term resolver every exporter and the
// on-screen row go through. A stripped entry has no mkb_term either (the
// backend deletes the orphan label with the code), so this must fall through to
// the spoken wording rather than returning ''.
test('filedComorbidityTerm falls back to the spoken diagnosis when no code/term survives', () => {
  assert.strictEqual(filedComorbidityTerm(codeless), 'Гонартроза');
});

test('filedComorbidityTerm still prefers the official term when one survives', () => {
  assert.strictEqual(
    filedComorbidityTerm({ diagnoza: 'Захарен диабет', mkb: 'E11', mkb_term: 'Неинсулинозависим захарен диабет' }),
    'Неинсулинозависим захарен диабет',
  );
});
