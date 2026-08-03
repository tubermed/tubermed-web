// ─────────────────────────────────────────────────────────────────────────────
// No export may THROW because a contract field the type declares required turned
// out to be absent at runtime.
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm run test   (node --test, Node 24 strips the types natively.)
//
// THE DEFECT CLASS. `DiagnosisLine` typed its `code` prop `string` and called
// `code.trim()` unguarded; the backend then started DELETING that key. TypeScript
// never complained, because the type was not wrong about itself — it was wrong
// about the runtime. That is a CONTRACT bug, and no compiler catches it.
//
// Sweeping the export path for the same shape found one more: `Medication.inn` is
// typed required in lib/types.ts, the backend never normalises it (every backend
// reader type-guards `typeof m.inn === 'string'`), and `escapeHtml(m.inn)` runs
// unguarded in both generatePdfHtml and generateWordHtml.
//
// ⚠ HONEST SEVERITY: unlike the DiagnosisLine case — a certain crash, because the
// paired backend change deletes the key — this one is LATENT. Measured across 348
// artifacts: 0 of 677 medication rows lack `inn`, 0 of 259 comorbidity rows lack
// `diagnoza`. The type lies; the model has never exercised the lie. The fix is
// therefore a widening at the choke point (escapeHtml tolerates absent), not a
// contract change rippled through MedsPanel and MedsPicker for a hazard with zero
// observed instances.
//
// These tests deliberately feed shapes the TYPES forbid — that is the point. The
// casts are how a runtime contract violation gets expressed in a typed test.

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

const { formatPlainText, generatePdfHtml, generateWordHtml, escapeHtml } =
  await import('../lib/exporters.ts');

const DATE = '03.08.2026';

const renderers: Array<[string, (f: TranscribeFields) => string]> = [
  ['formatPlainText', (f) => formatPlainText(f)],
  ['generatePdfHtml', (f) => generatePdfHtml(f, DATE)],
  ['generateWordHtml', (f) => generateWordHtml(f, DATE)],
];

function base(over: Partial<TranscribeFields> = {}): TranscribeFields {
  return {
    anamneza: 'Пациентът съобщава кашлица.',
    osnovna_diagnoza: 'Остър бронхит',
    osnovna_mkb: 'J20.9',
    ...over,
  } as TranscribeFields;
}

// ── escapeHtml, the choke point ─────────────────────────────────────────────

test('escapeHtml tolerates an absent value instead of throwing', () => {
  assert.strictEqual(escapeHtml(undefined), '');
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(''), '');
});

test('escapeHtml still escapes exactly as before for defined input', () => {
  assert.strictEqual(escapeHtml('<a href="x">&\'</a>'),
    '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

// ── the export paths ────────────────────────────────────────────────────────

for (const [name, render] of renderers) {
  test(`${name}: a medication row with NO inn does not throw`, () => {
    const f = base({
      medications_list: [{ dose: '5 mg', regimen: '1x1' }] as TranscribeFields['medications_list'],
    });
    let out = '';
    assert.doesNotThrow(() => { out = render(f); },
      `${name} threw on a medication row missing the required-typed inn`);
    assert.ok(!/undefined/.test(out), `${name} leaked "undefined" onto the document`);
  });

  test(`${name}: a medication row with no inn does not lose its coded sibling`, () => {
    const f = base({
      medications_list: [
        { dose: '5 mg' },
        { inn: 'амоксицилин', dose: '500 mg' },
      ] as TranscribeFields['medications_list'],
    });
    const out = render(f);
    assert.ok(out.includes('амоксицилин'), `${name} dropped the well-formed sibling row`);
  });

  test(`${name}: a comorbidity with NO diagnoza and no code does not throw`, () => {
    const f = base({
      pridruzhavashti: [{}] as TranscribeFields['pridruzhavashti'],
    });
    let out = '';
    assert.doesNotThrow(() => { out = render(f); },
      `${name} threw on a comorbidity row missing every field`);
    assert.ok(!/undefined/.test(out), `${name} leaked "undefined" onto the document`);
  });

  test(`${name}: an entirely empty fields object does not throw`, () => {
    assert.doesNotThrow(() => render({} as TranscribeFields),
      `${name} threw on an empty note — the sealed лист has no recovery path`);
  });
}
