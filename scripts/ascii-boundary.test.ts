// ─────────────────────────────────────────────────────────────────────────────
// ASCII-boundary guard — no regex primitive that cannot see Bulgarian.
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm run test   (node --test, Node 24 strips the types natively.)
//
// WHY THIS FILE EXISTS: this repo is where the defect was found. While writing
// the round-2 pinned test in scripts/eu-claims.test.ts, a probe containing a
// banned residency claim VERBATIM was inserted and the gate reported green. The
// rule used `\b` after Cyrillic „на", and JS's `\b`, `\w` and `\W` are
// ASCII-only: Cyrillic letters are not `\w` characters, so there is no word
// boundary between „а" and a space and the pattern matched nothing at all.
//
// That is the fourth named gate-failure shape in this project and the first
// that is a runtime/language mismatch rather than a logic slip. It fails in the
// GREEN direction, and it is invisible to any test that only ever asserts the
// happy path — the rule looked correct, the suite looked green, and the claim
// was in the shipped file.
//
// TuberMed is a Bulgarian-language product. Every string this app matches —
// product copy, note fields, diagnosis and drug names, doctor input — can be
// Cyrillic. So the primitives are banned unless the site says why it is safe:
//
//     // ascii-safe: <reason>
//
// on the line itself or anywhere in the comment block directly above it.
// „The input here is a hex colour" is a fine reason. „It works" is not.
//
// ⚠ THE GLOB'S COVERAGE CHANGES THE MOMENT YOU `git add`.
// This guard enumerates `git ls-files`, so an UNTRACKED file is invisible to
// it. A new file therefore passes every gate while you are writing it and can
// go red on the very next run, after the commit that tracked it — twice on
// 2026-08-19 alone, both times on a freshly written test file. That is the
// verified-while-untracked shape: the check did not fail, it did not RUN.
// Run the suite once AFTER `git add`, before you trust a green.
//
// The backend carries the same guard as scripts/test-ascii-boundary.js.

import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const SOURCE_EXT = /\.(js|ts|tsx|jsx|mjs|cjs)$/;

// Built by concatenation so this file does not trip its own scan. The guard
// scans itself like any other file — a self-exemption would be a blind spot in
// exactly the tool whose job is to have none.
const BS = '\\';
// No lookahead after the primitive: `\b` `\B` `\w` `\W` are complete escapes,
// and requiring a non-word character after one silently misses `/\bBP\b/`.
const PRIMITIVE_RE = new RegExp(BS + BS + '{1,2}[bBwW]');
const MARKER_RE = /\/\/\s*ascii-safe:\s*\S/;
const COMMENT_LINE_RE = /^\s*(\/\/|\*|\/\*)/;

function stripBlockComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

// The marker may sit on the line itself or anywhere in the contiguous comment
// block above it — a reason worth writing is often several lines, and a
// one-line budget pushes authors toward terse reasons that say nothing.
function isMarked(raw: string[], i: number): boolean {
  if (MARKER_RE.test(raw[i])) return true;
  for (let j = i - 1; j >= 0 && COMMENT_LINE_RE.test(raw[j]); j--) {
    if (MARKER_RE.test(raw[j])) return true;
  }
  return false;
}

function scanText(text: string): Array<{ line: number; src: string }> {
  const lines = stripBlockComments(text).split('\n');
  const raw = text.split('\n');
  const hits: Array<{ line: number; src: string }> = [];
  lines.forEach((line, i) => {
    // A line that is entirely a comment is prose ABOUT the trap, not a use of it.
    if (COMMENT_LINE_RE.test(line)) return;
    if (!PRIMITIVE_RE.test(line)) return;
    if (!isMarked(raw, i)) hits.push({ line: i + 1, src: raw[i].trim() });
  });
  return hits;
}

// ── The detector must be able to fail ────────────────────────────────────────
// A guard that has never been seen to fail is not a guard — and a guard against
// vacuous gates that was itself vacuous would be the joke writing itself.
test('the detector is not blind — it catches what it claims to catch', () => {
  // The PAYLOADS below are built from BS so they carry a real primitive at runtime
  // without putting one in this source. The case LABELS cannot be: a label names the
  // primitive under test, and naming it is the whole point of the label. They are
  // marked one by one rather than exempted as a block — `isMarked` deliberately
  // reaches only the first line under a comment, so a block exemption would silently
  // cover code nobody classified.
  const cases: Array<[string, string, number]> = [
    ['unmarked \\b', `const re = /${BS}bост${BS}b/;`, 1], // ascii-safe: case label, matched against nothing
    ['unmarked \\w', `const re = /${BS}w+/;`, 1], // ascii-safe: case label, matched against nothing
    ['\\\\b inside a string', `new RegExp('${BS}${BS}bfoo');`, 1], // ascii-safe: case label, matched against nothing
    ['\\b followed by a letter', `const re = /${BS}bBP${BS}b/;`, 1], // ascii-safe: case label, matched against nothing
    ['marker on the same line', `const re = /${BS}bBP${BS}b/; // ascii-safe: Latin acronym`, 0],
    ['marker on the line above', `// ascii-safe: hex only\nconst re = /${BS}w+/;`, 0],
    [
      'marker higher in the comment block',
      `// ascii-safe: a Sentry DSN is ASCII by construction,\n// so the boundary means what it says.\nconst re = /${BS}bhttps${BS}b/;`,
      0,
    ],
    ['comment block with no marker', `// matches terms\n// been here a while\nconst re = /${BS}bостр/;`, 1],
    ['a full-line comment is not a use', `// NB: ${BS}b is ASCII-only and fails on Cyrillic`, 0],
    ['a block comment is not a use', `/* uses ${BS}b deliberately */\nconst x = 1;`, 0],
    ['Unicode-aware code passes', `const re = /(?<![${BS}p{L}])ост(?![${BS}p{L}])/u;`, 0],
    ['ordinary prose does not fire', `const label = 'web browser bandwidth';`, 0],
  ];
  for (const [why, text, expect] of cases) {
    assert.strictEqual(scanText(text).length, expect, `detector case failed: ${why}`);
  }
});

// ── The real scan ────────────────────────────────────────────────────────────
test('no ASCII-only regex primitive in shipped source without a written reason', () => {
  const files = execSync('git ls-files', { cwd: REPO, encoding: 'utf8', maxBuffer: 64e6 })
    .split('\n')
    .filter((f) => SOURCE_EXT.test(f));

  const offenders: string[] = [];
  for (const rel of files) {
    let text: string;
    try {
      text = readFileSync(path.join(REPO, rel), 'utf8');
    } catch {
      continue;
    }
    for (const h of scanText(text)) offenders.push(`${rel}:${h.line} — ${h.src}`);
  }

  assert.deepStrictEqual(
    offenders,
    [],
    `ASCII-only regex primitive(s) with no written reason:\n  ${offenders.join('\n  ')}\n\n` +
      // The remediation text has to name the primitives it is telling you to replace.
      // Marked per line for the same reason the case labels are.
      'JS \\b \\B \\w \\W are ASCII-only. Cyrillic letters are not \\w characters, so\n' + // ascii-safe: help text, matched against nothing
      'between „а" and a space there is NO word boundary and the pattern matches\n' +
      'NOTHING — green, silently, forever. This is how a banned residency claim sat\n' +
      'in a shipped file behind a passing test (scripts/eu-claims.test.ts, round 2).\n\n' +
      'If the matched string can be Bulgarian — product copy, a note field, a drug\n' +
      'or diagnosis name, doctor input, a fixture, a test assertion — replace it:\n\n' +
      '    \\b  ->  (?<![\\p{L}\\p{N}_])  …  (?![\\p{L}\\p{N}_])\n' + // ascii-safe: help text, matched against nothing
      '    \\w  ->  [\\p{L}\\p{N}_]\n' + // ascii-safe: help text, matched against nothing
      '    \\W  ->  [^\\p{L}\\p{N}_]\n\n' + // ascii-safe: help text, matched against nothing
      '…and put the u flag on the regex.\n\n' +
      'If the input genuinely cannot be Cyrillic — a model id, an env var name, a\n' +
      'URL, a hex string, a JSON key, an МКБ code — say so at the site:\n\n' +
      '    // ascii-safe: <why this input is ASCII by construction>\n\n' +
      'Write the reason. The marker exists so the next person inherits the\n' +
      'classification instead of re-deriving it.',
  );
});
