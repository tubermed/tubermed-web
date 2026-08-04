// ─────────────────────────────────────────────────────────────────────────────
// The data-residency claims, pinned in both directions.
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm run test   (node --test, Node 24 strips the types natively.)
//
// WHY THIS FILE EXISTS: for months tubermed.com told doctors "Обработка в ЕС",
// "Данните не напускат ЕС" and "Без прехвърляне към САЩ". None of it was true —
// the extraction call goes to US api.anthropic.com (AGENTS.md) — and it
// contradicted our own Fundamentals/Intended-Purpose-Statement.md §5, which
// states in writing that we make neither claim. Nothing caught it: it is copy,
// so tsc, eslint and next build are all indifferent, and the claim had spread
// to JSON-LD, the OG/Twitter cards, an in-app header, the sign-in panel and the
// hero mockup — surfaces nobody re-reads when they edit a paragraph.
//
// The negative half makes a returning claim a red test. The positive half
// matters just as much: a negative-only assertion passes happily against a file
// someone emptied, so a refactor that deletes the trust line entirely would
// ship a page making no claim at all and this gate would stay green.
//
// SCOPE: source, not the built output. `.next/` is derived from these files, so
// a source-clean tree cannot emit a dirty bundle for a string literal, and
// making the scan conditional on a build having run would be a gate that
// silently skips — the failure mode this repo has shipped three times already.

import { test } from 'node:test';
import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

// Every surface that ships to a doctor or a crawler. `docs/` is deliberately
// absent: docs/history/*.md is a dated record of what the site USED to say, and
// rewriting it to satisfy a lint would falsify the log.
const SCAN_ROOTS = ['app', 'components', 'lib', 'public', 'scripts'];

// This file quotes every banned string as its own fixture, so it must not scan
// itself. It is the ONLY exemption — keep it that way.
const SELF = join('scripts', 'eu-claims.test.ts');

const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);
const TEXT_EXT = /\.(tsx?|jsx?|mjs|cjs|json|svg|txt|html|xml|webmanifest|md)$/;

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (TEXT_EXT.test(entry)) out.push(abs);
    }
  };
  for (const r of SCAN_ROOTS) walk(join(ROOT, r));
  return out.filter((f) => relative(ROOT, f) !== SELF);
}

/** Every scanned file, read once, keyed by repo-relative path. */
const CORPUS: ReadonlyArray<readonly [string, string]> = sourceFiles().map(
  (abs) => [relative(ROOT, abs).split(sep).join('/'), readFileSync(abs, 'utf8')] as const,
);

// ── The banned claims ────────────────────────────────────────────────────────
// Matched case-insensitively: the same lie shipped as both "Обработка в ЕС" and
// "обработка в ЕС", and a sweep that pins only one case finds only one of them.
const BANNED: ReadonlyArray<readonly [string, string]> = [
  ['Обработка в ЕС', 'inference runs in the US — we do not process everything in the EU'],
  ['не напускат ЕС', 'the data does leave the EU for the AI step'],
  ['не напуска ЕС', 'the data does leave the EU for the AI step'],
  ['без прехвърляне', 'there IS a transfer to the US; Intended-Purpose-Statement §5 forbids denying it'],
  ['Никакво прехвърляне', 'there IS a transfer to the US'],
  ['изцяло в ЕС', 'processing is not entirely in the EU'],
  ['100% обработка', 'processing is not 100% in the EU'],
  ['остава авторът', 'grammar: after остава the predicative noun is bare — "остава автор"'],
  // Found by the 2026-08-04 sweep, none of which the prompt-supplied search
  // strings would have matched. They are the same claim in other clothes.
  ['EU инфраструктура', 'same claim, Latin spelling'],
  ['се обработват в EU', 'the sign-in panel wording — Latin EU + обработват dodged every search'],
  ['Нищо не се изпраща към САЩ', 'content IS sent to a US provider'],
  ['Данните остават в Европа', 'as a heading this asserts nothing leaves — it does'],
  // Frankfurt is not inherently false, it is UNVERIFIED: nothing in this repo
  // establishes it, and it rode along with the claims above every time. If a
  // real, checked hosting location is ever established, delete the line and say
  // so in the commit — do not quietly reintroduce it in copy.
  ['Франкфурт', 'unverified location claim'],
  ['Frankfurt', 'unverified location claim'],
];

// ── The approved replacements ────────────────────────────────────────────────
const SHORT_FORM = 'Данните се съхраняват в ЕС';
const LONG_FORM =
  'Аудиото и записите се обработват и съхраняват в ЕС. Обработката с ИИ се извършва от доставчик ' +
  'по договор за обработване на данни (DPA) и Стандартни договорни клаузи (SCC); съдържанието не ' +
  'се съхранява и не се използва за обучение на модели.';
const AUTHOR_LINE = 'Лекарят остава автор';

test('NEGATIVE: no banned residency or authorship claim appears in shipped source', () => {
  const offenders: string[] = [];
  for (const [needle, why] of BANNED) {
    const lower = needle.toLowerCase();
    for (const [path, text] of CORPUS) {
      const lines = text.toLowerCase().split('\n');
      lines.forEach((line, i) => {
        if (line.includes(lower)) offenders.push(`${path}:${i + 1} — "${needle}" (${why})`);
      });
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `banned claim(s) back in the codebase:\n  ${offenders.join('\n  ')}\n\n` +
      'These are not style preferences. Intended-Purpose-Statement.md §5 says in ' +
      'writing that we claim neither EU-only processing nor the absence of US ' +
      'transfer, and this is a health product on a public commercial site.',
  );
});

test('POSITIVE: the short trust line is present on every surface that carried a claim', () => {
  const required = [
    ['app/layout.tsx', 'metadata + OG + Twitter descriptions'],
    ['components/landing/Hero.tsx', 'the hero trust line under the CTAs'],
    ['components/landing/TrustStrip.tsx', 'the landing trust badges'],
    ['components/landing/TuberMedHeroLoop.tsx', 'the animated mockup chip and end card'],
    ['app/app/scribe/page.tsx', 'shown to the doctor at the moment they press record'],
    ['components/AuthBrandPanel.tsx', 'the sign-in panel'],
  ] as const;
  for (const [path, where] of required) {
    const file = CORPUS.find(([p]) => p === path);
    assert.ok(file, `${path} vanished — this test's map of the site is stale`);
    // Case-insensitive on purpose: the line is a standalone chip in some places
    // ("Данните…") and mid-sentence in the metadata ("…, данните…"). Sentence
    // position is not the claim.
    assert.ok(
      file[1].toLowerCase().includes(SHORT_FORM.toLowerCase()),
      `${path} no longer states "${SHORT_FORM}" (${where}). A page that makes NO ` +
        'residency claim is not the safe outcome here — it is a silent deletion ' +
        'of the thing doctors ask about first. Restore it or update this test on purpose.',
    );
  }
});

test('POSITIVE: the long form survives verbatim wherever there is room for it', () => {
  const required = [
    'components/landing/Faq.tsx',
    'components/landing/JsonLd.tsx',
    'components/landing/Security.tsx',
    'components/landing/WhyTuberMed.tsx',
  ];
  for (const path of required) {
    const file = CORPUS.find(([p]) => p === path);
    assert.ok(file, `${path} vanished — this test's map of the site is stale`);
    assert.ok(
      file[1].includes(LONG_FORM),
      `${path} no longer carries the approved long form verbatim. Partial edits are ` +
        'the risk here: softening one clause (dropping the SCCs, or the ' +
        'no-training sentence) turns a precise statement back into an evasive one.',
    );
  }
});

test('POSITIVE: the corrected authorship line is present, in the fixed grammar', () => {
  const carriers = CORPUS.filter(([, t]) => t.includes(AUTHOR_LINE)).map(([p]) => p);
  assert.deepStrictEqual(
    carriers.sort(),
    [
      'app/layout.tsx',
      'components/landing/Hero.tsx',
      'components/landing/TuberMedHeroLoop.tsx',
    ],
    'the "Лекарят остава автор" line moved or was dropped',
  );
});

test('the FAQ answer and its JSON-LD twin stay byte-identical', () => {
  // JsonLd.tsx's own header states this rule. It is pinned here because the
  // residency answer is exactly the one that gets edited on the visible page
  // and forgotten in the structured data, where crawlers keep serving the old
  // text long after the browser shows the new one.
  const faq = CORPUS.find(([p]) => p === 'components/landing/Faq.tsx')![1];
  const jsonLd = CORPUS.find(([p]) => p === 'components/landing/JsonLd.tsx')![1];
  const pull = (src: string, key: string) =>
    src.match(new RegExp(`${key}: '(Аудиото[^']*)'`))?.[1] ?? null;
  const a = pull(faq, 'a');
  const b = pull(jsonLd, 'text');
  assert.ok(a, 'the residency answer is gone from Faq.tsx');
  assert.strictEqual(b, a, 'JSON-LD drifted from the visible FAQ answer');
});

test('the scan actually reads the site — a corpus that shrinks is a blind gate', () => {
  // Guards the whole file: if SCAN_ROOTS, the extension filter or the walker
  // ever silently stops matching, every assertion above passes vacuously.
  assert.ok(
    CORPUS.length > 100,
    `only ${CORPUS.length} files scanned — the walker is not seeing the codebase`,
  );
  assert.ok(
    CORPUS.some(([p]) => p === 'components/landing/Hero.tsx'),
    'the landing components are outside the scan — the negative test proves nothing',
  );
  assert.ok(
    CORPUS.every(([p]) => p !== SELF.split(sep).join('/')),
    'this test file must not scan itself; it quotes every banned string',
  );
});
