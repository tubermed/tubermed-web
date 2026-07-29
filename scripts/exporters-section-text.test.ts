// ─────────────────────────────────────────────────────────────────────────────
// lib/exporters.ts — per-section copy text for Изследвания / Издадени документи.
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm run test   (node --test, Node 24 strips the types natively.)
//
// THE INVARIANT THIS FILE PINS: the per-section copy buttons on the result page
// put on the clipboard EXACTLY the section body that the full-document copy
// (formatPlainText) emits under that section's header — same helpers, same
// order, same subsection labels. The card, the three exporters, and now the
// per-section copy must stay word-identical; these tests fail if anyone forks
// the serialization instead of reusing it.
//
// registerHooks note: lib/exporters.ts sits in an import graph that uses
// extensionless relative imports (the app bundler resolves them; plain
// `node --test` cannot). The sync resolve hook below retries a failed relative
// resolution with `.ts` appended. It is local to this test file — no app code
// or tsconfig change. @types/node 20 predates registerHooks, hence the narrow
// local typing instead of a named import.

import { test } from 'node:test';
import assert from 'node:assert';
import Module from 'node:module';
import type { TranscribeFields, EchoFields } from '../lib/types.ts';

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

const { formatPlainText, blockParagraph, izsledvaniaSectionText, izdadeniSectionText } =
  await import('../lib/exporters.ts');
const { getInvestigationBlockDescriptor } = await import('../lib/investigation-blocks.ts');

// An ЕКГ (renderStyle:'paragraph') block — the shape the backend emits for an
// embedded ЕКГ reading. Flat template paths, not the nested echo shape, so the
// cast goes through unknown (the app receives this as parsed JSON, untyped).
const ekgBlockFields = {
  ritam: 'синусов ритъм',
  chestota: { value: '68', unit: 'уд/мин' },
  nahodki: 'без исхемични промени',
} as unknown as EchoFields;

function fixture(): TranscribeFields {
  return {
    anamneza: 'Оплаква се от умора.',
    izsledvania: 'Хемоглобин [[139]] g/l',
    naznacheni: 'ПКК, СУЕ',
    terapia: 'Контролен преглед след един месец.',
    napravlenia: 'Направление за кардиолог №7',
    izsledvania_blocks: [{ type: 'ekg', template: 'ekg-v1', fields: ekgBlockFields }],
  };
}

// ── Word-identity with the full-document copy ────────────────────────────────

test('Изследвания section copy text is byte-identical to the formatPlainText section body', () => {
  const f = fixture();
  const body = izsledvaniaSectionText(f);
  assert.ok(body.length > 0, 'populated fixture must produce a non-empty section body');
  // The full document must contain header + blank line + EXACTLY this body,
  // terminated by the blank line before ТЕРАПИЯ. Any drift — reordering, label
  // change, forked block serialization — breaks this containment.
  const full = formatPlainText(f);
  assert.ok(
    full.includes('ИЗСЛЕДВАНИЯ\n\n' + body + '\n\nТЕРАПИЯ'),
    'section body must slot verbatim between its header and the next section:\n' + body,
  );
});

test('Издадени документи section copy text is byte-identical to the formatPlainText section body', () => {
  const f = fixture();
  const body = izdadeniSectionText(f);
  assert.ok(body.length > 0, 'populated fixture must produce a non-empty section body');
  // ИЗДАДЕНИ ДОКУМЕНТИ is the last section formatPlainText emits and the
  // document is trimmed, so the full text must END with header + body.
  const full = formatPlainText(f);
  assert.ok(
    full.endsWith('ИЗДАДЕНИ ДОКУМЕНТИ\n\n' + body),
    'section body must be the verbatim tail of the document:\n' + body,
  );
});

// ── The block paragraph is REUSED, never forked ──────────────────────────────

test('a paragraph-style block reaches the section text through blockParagraph verbatim', () => {
  const d = getInvestigationBlockDescriptor('ekg');
  assert.ok(d, 'ekg descriptor must be registered');
  const para = blockParagraph(ekgBlockFields, d.sections);
  assert.ok(para.length > 0, 'populated ЕКГ block must serialize to a paragraph');
  assert.ok(
    izsledvaniaSectionText(fixture()).includes(d.title + ': ' + para),
    'the section text must contain the SAME string the card and exporters render',
  );
});

// ── Formatting contract details ──────────────────────────────────────────────

test('subsection labels match the exporters', () => {
  const body = izsledvaniaSectionText(fixture());
  assert.ok(body.includes('Резултати от изследвания:\n'), 'results label');
  assert.ok(body.includes('Назначени изследвания:\n'), 'ordered-tests label');
  assert.ok(izdadeniSectionText(fixture()).includes('Направления:\n'), 'referrals label');
});

test('uncertain-span markers are stripped, as in every exporter', () => {
  const body = izsledvaniaSectionText(fixture());
  assert.ok(body.includes('Хемоглобин 139 g/l'), 'marker content kept');
  assert.ok(!body.includes('[['), 'marker brackets stripped');
});

test('empty sections produce empty copy text', () => {
  assert.equal(izsledvaniaSectionText({}), '');
  assert.equal(izdadeniSectionText({}), '');
});

test('a blocks-only Изследвания section still serializes (no flat-text dependency)', () => {
  const f: TranscribeFields = {
    izsledvania_blocks: [{ type: 'ekg', template: 'ekg-v1', fields: ekgBlockFields }],
  };
  const body = izsledvaniaSectionText(f);
  assert.ok(body.length > 0, 'blocks alone must produce a body');
  assert.ok(!body.includes('Резултати от изследвания:'), 'no empty-subsection labels');
});
