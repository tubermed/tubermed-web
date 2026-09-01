// ─────────────────────────────────────────────────────────────────────────────
// Voice gate — formal address is CAPITALIZED: Вие, Ви, Вас, Ваш.
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm test   (node --test, Node 24 strips the types natively.)
//
// WHY THIS FILE EXISTS: Brand-Voice-and-Language.md says the product speaks to
// the doctor in second person formal, capitalized. On 2026-09-01 a sweep found
// NINE lowercase sites live across six surfaces (FAQ + its JSON-LD twin, the
// privacy page, the onboarding wizard, the patient-summary confirm, the scribe
// recovery copy, the upload-retry promises) — copy that tsc, eslint and the
// build are all indifferent to. This gate makes the tenth site a red test.
//
// WHAT IT COVERS — and, just as deliberately, what it does not:
//   COVERED: every .ts/.tsx under app/, components/ and lib/ — the three roots
//     all user-facing strings live in — with comments blanked out first, so a
//     hit is by construction inside a string literal or JSX text. Within that
//     scope the check is PRECISE: Cyrillic never appears in identifiers here,
//     and there is no legitimate standalone lowercase ви/вас/вие/ваш* in copy
//     addressed to the doctor. Anything that ever becomes legitimate goes in
//     ALLOW below, with its reason, not into a loosened regex.
//   NOT COVERED, on purpose:
//     - comments (not user-facing; they may quote old copy in prose),
//     - docs/ (a dated record of what the site USED to say — rewriting it to
//       satisfy a lint would falsify the log; the same ruling as eu-claims),
//     - scripts/ (tests pin copy as fixtures; the pinning test updates with
//       the copy it pins, and flagging the fixture would double-count),
//     - public/ (register-data mirrors and static assets — no authored copy;
//       if authored copy ever lands there, add the root here).
//
// ⚠ NEVER \b: JS word boundaries are ASCII-only and the `u` flag does not fix
// them — between Cyrillic letters and anything else there is no boundary at
// all, so a \b-based version of this gate matches NOTHING and stays green over
// a file full of defects (the ASCII-boundary gate-failure shape, proven in
// both repos). Explicit Unicode-letter lookarounds only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SCAN_ROOTS = ['app', 'components', 'lib'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);
const CODE_EXT = /\.tsx?$/;

// Standalone lowercase second-person address forms. Case-sensitive on purpose:
// the capitalized forms are the law being enforced. The lookarounds are the
// Unicode word boundary JS does not have (see the header warning).
const LOWERCASE_ADDRESS =
  /(?<![\p{L}\p{M}])(?:ви|вас|вие|ваш(?:а|е|и|ия|ият|ата|ето|ите)?)(?![\p{L}\p{M}])/u;

// Justified exceptions ONLY: [repo-relative path, exact offending line
// fragment, one-line reason]. An entry that no longer matches anything is
// stale and fails the gate — delete it with the code that earned it.
const ALLOW: ReadonlyArray<readonly [string, string, string]> = [
  // (none today — the 2026-09-01 sweep left zero legitimate lowercase sites)
];

// Blank comments while preserving line structure, so reported line numbers
// match the source (same idiom as scripts/no-emoji-ui.ts): block/JSDoc/{/*…*/}
// first, then line comments. The stripper is not string-aware; the (?<!:)
// keeps a URL's `//` (as in `https://…`) from blanking the rest of a copy
// line — the refuter's find: copy AFTER a URL would otherwise be invisible
// to the gate. Residual limit, stated: a bare `//` inside a string literal
// with no preceding colon still blanks the line's tail. That can only HIDE
// a defect on such a line, never flag a clean one.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(?<!:)\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (CODE_EXT.test(entry)) out.push(abs);
    }
  };
  for (const r of SCAN_ROOTS) walk(join(ROOT, r));
  return out;
}

const CORPUS: ReadonlyArray<readonly [string, string]> = sourceFiles().map(
  (abs) => [relative(ROOT, abs).split(sep).join('/'), readFileSync(abs, 'utf8')] as const,
);

test('detector control: the regex sees the defect class and spares the law', () => {
  // The gate polices a character class the rest of the toolchain is blind to,
  // so it must first prove it can see it AT ALL — a regex edit that blinds the
  // detector otherwise turns every assertion below vacuous-green (the shape
  // this repo has shipped and sworn off; exit-2-when-blind, in test clothes).
  const mustFlag = [
    'данните ви',
    'Няколко думи за вас',
    'вие сте авторът',
    'винаги ваш',
    'във вашия софтуер',
    'без вашето одобрение',
    'за вашата практика',
    'вашият лист',
  ];
  for (const s of mustFlag) {
    assert.ok(LOWERCASE_ADDRESS.test(s), `detector went blind: failed to flag "${s}"`);
  }
  const mustPass = [
    'данните Ви', // the law itself
    'Вие сте авторът',
    'във Вашия софтуер',
    'да се развие', // ви embedded in a word — the lookarounds must hold
    'вискозитет', // ви as a prefix
    'здравейте', // no address form at all
  ];
  for (const s of mustPass) {
    assert.ok(!LOWERCASE_ADDRESS.test(s), `false positive: flagged "${s}"`);
  }

  // Comment-stripping control (the refuter's find): a URL inside copy must not
  // act as a line comment and hide the defect after it, while a real trailing
  // comment must still be blanked.
  const urlLine = "  x = 'вижте https://пример.бг — данните ви';";
  assert.ok(
    LOWERCASE_ADDRESS.test(stripComments(urlLine)),
    'stripComments swallowed copy after a URL — the gate is blind to that line tail',
  );
  const commentLine = "  x = 1; // quoting the OLD copy: данните ви";
  assert.ok(
    !LOWERCASE_ADDRESS.test(stripComments(commentLine)),
    'stripComments no longer blanks trailing comments — comment prose would flag',
  );
});

test('no standalone lowercase second-person address in user-facing copy', () => {
  const offenders: string[] = [];
  for (const [path, text] of CORPUS) {
    stripComments(text)
      .split('\n')
      .forEach((line, i) => {
        const m = line.match(LOWERCASE_ADDRESS);
        if (!m) return;
        if (ALLOW.some(([p, frag]) => p === path && line.includes(frag))) return;
        offenders.push(`${path}:${i + 1} — "${m[0]}" in: ${line.trim().slice(0, 90)}`);
      });
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `lowercase formal address back in user-facing copy:\n  ${offenders.join('\n  ')}\n\n` +
      'Brand-Voice-and-Language.md: second person formal is CAPITALIZED — Вие, ' +
      'Ви, Вас, Ваш. Fix the copy (and, if a test pins it, the pin in the same ' +
      'commit); a genuinely legitimate lowercase use goes into ALLOW with a reason.',
  );
});

test('every ALLOW entry still earns its keep', () => {
  // A stale exception is a hole the next defect walks through unlogged.
  for (const [path, frag, reason] of ALLOW) {
    const file = CORPUS.find(([p]) => p === path);
    assert.ok(file, `ALLOW entry for missing file ${path} (${reason}) — delete it`);
    assert.ok(
      file[1].split('\n').some((l) => l.includes(frag) && LOWERCASE_ADDRESS.test(l)),
      `ALLOW entry no longer matches anything in ${path} (${reason}) — delete it`,
    );
  }
});

test('the walk actually resolves the copy surfaces — a shrunken corpus is a blind gate', () => {
  assert.ok(
    CORPUS.length > 80,
    `only ${CORPUS.length} files scanned (115 at gate birth) — the walker is not seeing the codebase`,
  );
  // Zero-strings guard: the corpus must demonstrably contain second-person
  // copy for the negative assertion above to be about anything. The
  // capitalized forms are the proof that survives a fully-fixed tree.
  const CAPITALIZED = /(?<![\p{L}\p{M}])(?:Ви|Вас|Вие|Ваш(?:а|е|и|ия|ият|ата|ето|ите)?)(?![\p{L}\p{M}])/u;
  const carriers = CORPUS.filter(([, t]) => CAPITALIZED.test(stripComments(t)));
  assert.ok(
    carriers.length > 0,
    'no scanned file carries ANY second-person address — the scan roots have drifted off the copy',
  );
  for (const known of ['components/landing/Faq.tsx', 'lib/upload-retry.ts', 'app/privacy/page.tsx']) {
    assert.ok(
      CORPUS.some(([p]) => p === known),
      `${known} is outside the scan — the negative test proves nothing`,
    );
  }
});
