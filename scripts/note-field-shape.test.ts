// ─────────────────────────────────────────────────────────────────────────────
// Note-field shape guard — no note field read with a method it may not have.
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm run test   (node --test, Node 24 strips the types natively.)
//
// WHY THIS FILE EXISTS. Three times now, the same defect:
//
//   2026-08-03  DiagnosisLine.code.trim()      — backend began `delete entry.mkb`
//   2026-08-06  /edit wrote pridruzhavashti as a non-array; every reader threw
//   2026-08-08  izsledvania arrived as `[]`; `.trim()` killed the result page
//
// Each was fixed at its crash site, and each time the class came back somewhere
// else. It keeps coming back because the codebase's standard defensive idiom
// does not defend against it. `(f.x || [])` and `(s || '')` rescue null and
// undefined and NOTHING ELSE: `[] || ''` evaluates to `[]`, `'x' || []`
// evaluates to `'x'`. A truthy value of the wrong type walks through the
// fallback into a method that does not exist on it. The guard looks present,
// reads as defensive, and is inert against the only input that can reach it.
//
// tsc cannot see this either — `lib/types.ts` declares `izsledvania?: string`
// and the value really was an array at runtime. The type was not wrong about
// itself; it was wrong about the backend. That is the class AGENTS.md already
// names ("A REQUIRED type the backend does not GUARANTEE"), and a type checker
// is by construction the wrong tool for it.
//
// So: a note field may not be handed to a string or array method unless
// something at the site actually established its type —
//
//   • Array.isArray(…) / typeof … === 'string' naming that field, at the site
//     or in the six lines above it (the enclosing `if`), or
//   • it goes through asText() / asList() / fieldText() (lib/note-normalize.ts),
//     which absorb any shape, or
//   • the line carries a written reason:
//
//         // shape-checked: <reason>
//
//     on the line itself or anywhere in the comment block directly above it.
//     „The map is built locally with array values" is a fine reason. „It's
//     fine" is not.
//
// SCOPE — web only, deliberately. The backend settles every type at the
// extraction write boundary (tubermed-backend lib/note-shape.js
// `coerceNoteShape`) and its validators already guard with typeof/Array.isArray
// throughout; the same scan there would be ~40 markers on code that is already
// correct, which is how a guard gets disabled. The browser is where an
// unguarded read costs the doctor the visit.
//
// ⚠ This scan reads `git ls-files`. A file that is not yet TRACKED is INVISIBLE
// to it — `git add` before trusting a green run. That is not hypothetical: a
// guard was verified green against an untracked file in this repo two days ago.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const SOURCE_EXT = /\.(ts|tsx)$/;

// Only the surfaces that render or export a note. lib/ and components/ and the
// workspace app; the landing world has no note.
const IN_SCOPE = /^(app|components|lib)\//;

// The note contract — tubermed-backend lib/note-shape.js NOTE_FIELD_TYPES.
const STRING_FIELDS = [
  'anamneza', 'obektivno', 'izsledvania', 'terapia', 'napravlenia', 'naznacheni',
  'osnovna_diagnoza', 'osnovna_mkb', 'osnovna_mkb_term', 'osnovna_mkb_term_source', '_disclaimer',
];
const ARRAY_FIELDS = [
  'pridruzhavashti', 'alergii', 'medications_list', 'izsledvania_blocks',
  'uncertain_spans', 'med_alerts', 'field_notices', 'field_completeness', 'shape_repairs',
];
const FIELDS = [...STRING_FIELDS, ...ARRAY_FIELDS];

// Methods that do not exist on the other kind — a string has no .map, an array
// has no .trim. `.length` is deliberately EXCLUDED: it exists on both, so a
// wrong type there is a wrong ANSWER, not a thrown page, and flagging it would
// bury the crashes in noise.
const METHODS = [
  'trim', 'toLowerCase', 'toUpperCase', 'split', 'replace', 'replaceAll', 'startsWith',
  'endsWith', 'charAt', 'normalize', 'padEnd', 'padStart', 'localeCompare', 'match', 'matchAll',
  'map', 'forEach', 'filter', 'reduce', 'join', 'some', 'every', 'find', 'findIndex',
  'flatMap', 'sort', 'push', 'shift', 'unshift', 'splice',
];

const FIELD_ALT = FIELDS.join('|');
const METHOD_ALT = METHODS.join('|');

// 1. f.izsledvania.trim(…)
const DIRECT_RE = new RegExp(`\\.(${FIELD_ALT})\\s*(?:\\?\\.)?\\s*\\.?\\s*(?:\\?\\.)?(${METHOD_ALT})\\s*\\(`);
// 2. (f.pridruzhavashti || []).map(…)   —  the idiom that looks like a guard
const FALLBACK_RE = new RegExp(`\\.(${FIELD_ALT})\\s*\\|\\|\\s*(?:\\[\\]|''|"")\\s*\\)\\s*\\.\\s*(${METHOD_ALT})\\s*\\(`);
// 3. [...(f.pridruzhavashti || [])]  —  spreading a string yields CHARACTERS,
//    silently, with no error at all. The quietest member of the class.
const SPREAD_RE = new RegExp(`\\.\\.\\.\\s*\\(?\\s*[\\w.?]*\\.(${FIELD_ALT})\\s*\\|\\|`); // ascii-safe: matches a JS identifier chain; identifiers are ASCII by construction, and the Bulgarian in these files lives inside string literals this never enters

const MARKER_RE = /\/\/\s*shape-checked:\s*\S/;
const COMMENT_LINE_RE = /^\s*(\/\/|\*|\/\*)/;
// The normalizers. A read wrapped in one of these cannot throw whatever arrives.
const NORMALIZER_RE = /\b(asText|asList|fieldText|normalizeNoteFields)\s*(<[^>]*>)?\s*\(/; // ascii-safe: matches the helper function NAMES, which are ASCII identifiers

function stripBlockComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function isMarked(raw: string[], i: number): boolean {
  if (MARKER_RE.test(raw[i])) return true;
  for (let j = i - 1; j >= 0 && COMMENT_LINE_RE.test(raw[j]); j--) {
    if (MARKER_RE.test(raw[j])) return true;
  }
  return false;
}

// A real type check on THIS field, at the site or in the enclosing `if` above
// it. Six lines is the observed reach of a multi-line JSX guard (the
// izsledvania_blocks card guards three lines above its .map).
function isTypeChecked(field: string, lines: string[], i: number): boolean {
  const window = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
  // ascii-safe: both patterns match SOURCE CODE — an Array.isArray/typeof call
  // and a JS field name. Identifiers here are ASCII by construction; the
  // Bulgarian in these files lives inside string literals, which this never
  // enters.
  return (
    new RegExp(`Array\\.isArray\\(\\s*[\\w.\\[\\]'"?]*${field}\\s*\\)`).test(window) || // ascii-safe: matches source code, not prose
    new RegExp(`typeof\\s+[\\w.\\[\\]'"?]*${field}\\s*===\\s*['"]string['"]`).test(window) // ascii-safe: matches source code, not prose
  );
}

export function scanText(text: string): Array<{ line: number; field: string; method: string; src: string }> {
  const lines = stripBlockComments(text).split('\n');
  const raw = text.split('\n');
  const hits: Array<{ line: number; field: string; method: string; src: string }> = [];

  lines.forEach((line, i) => {
    if (COMMENT_LINE_RE.test(line)) return;             // prose about the trap, not a use
    for (const re of [DIRECT_RE, FALLBACK_RE, SPREAD_RE]) {
      const m = re.exec(line);
      if (!m) continue;
      const field = m[1];
      const method = m[2] ?? '(spread)';
      if (NORMALIZER_RE.test(line)) continue;
      if (isTypeChecked(field, lines, i)) continue;
      if (isMarked(raw, i)) continue;
      hits.push({ line: i + 1, field, method, src: raw[i].trim() });
      return;                                            // one finding per line
    }
  });
  return hits;
}

// ── The detector must be able to fail ───────────────────────────────────────
// A guard nobody has watched go red is not a guard. This is the same repo whose
// ASCII-boundary rule matched nothing at all while reading green.
test('the detector is not blind — it catches what it claims to catch', () => {
  const cases: Array<[string, string, number]> = [
    ['the live defect', `const has = !!(f.izsledvania && f.izsledvania.trim());`, 1],
    ['the || [] idiom', `const co = (f.pridruzhavashti || []).filter(Boolean);`, 1],
    ["the || '' idiom", `return clean((f.anamneza || '').trim());`, 1],
    ['spread of a maybe-string', `const next = [...(f.pridruzhavashti || []), row];`, 1],
    ['optional chaining is not a type check', `f.medications_list?.forEach((m) => m);`, 1],
    ['a second field on the same line still fires', `f.terapia.split('\\n');`, 1],
    ['Array.isArray on the line', `if (Array.isArray(f.alergii)) f.alergii.join(' ');`, 0],
    ['Array.isArray in the enclosing if', `if (Array.isArray(f.izsledvania_blocks)) {\n  ok();\n}\nf.izsledvania_blocks.map(x => x);`, 0],
    ['typeof === string', `if (typeof f.izsledvania === 'string') f.izsledvania.trim();`, 0],
    ['asText absorbs any shape', `const v = asText(f.izsledvania).trim();`, 0],
    ['asList absorbs any shape', `asList<Medication>(f.medications_list).forEach(m => m);`, 0],
    ['fieldText absorbs any shape', `const izs = fieldText(f.izsledvania);`, 0],
    ['marker on the same line', `f.izsledvania.trim(); // shape-checked: built locally, always a string`, 0],
    ['marker in the comment block above', `// shape-checked: this map is built here\n// with array values for every key\nuncertainByField.anamneza.forEach(s => s);`, 0],
    ['a comment block with no marker does not exempt', `// we map over these\n// as usual\nf.alergii.map(a => a);`, 1],
    ['a full-line comment is not a use', `// f.izsledvania.trim() used to throw here`, 0],
    ['.length is out of scope on purpose', `if (f.medications_list.length > 0) ok();`, 0],
    ['a non-note field is not our business', `payload.description.trim();`, 0],
    ['ordinary prose does not fire', `const label = 'изследвания и терапия';`, 0],
  ];
  for (const [why, text, expect] of cases) {
    assert.strictEqual(scanText(text).length, expect, `detector case failed: ${why}\n  ${text}`);
  }
});

// ── The real scan ───────────────────────────────────────────────────────────
test('no note field read with a string/array method without a type check', () => {
  const files = execSync('git ls-files', { cwd: REPO, encoding: 'utf8', maxBuffer: 64e6 })
    .split('\n')
    .filter((f) => SOURCE_EXT.test(f) && IN_SCOPE.test(f));

  assert.ok(files.length > 20, `expected to scan the app, got ${files.length} files — is anything tracked?`);

  const offenders: string[] = [];
  for (const rel of files) {
    let text: string;
    try {
      text = readFileSync(path.join(REPO, rel), 'utf8');
    } catch {
      continue;
    }
    for (const h of scanText(text)) {
      offenders.push(`${rel}:${h.line} — ${h.field}.${h.method}()  ${h.src}`);
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    `note field(s) read with a method their runtime type may not have:\n  ${offenders.join('\n  ')}\n\n` +
      'The backend contract is lib/types.ts, but a `?: string` there is a CLAIM, not\n' +
      'a guarantee — `izsledvania` arrived as `[]` on 9 live rows and `.trim()` took\n' +
      'the whole result page down, siblings and exports included.\n\n' +
      '`|| []` and `|| \'\'` do NOT fix this. They rescue null and undefined only:\n' +
      '`[] || \'\'` is `[]`, `\'x\' || []` is `\'x\'`, and the wrong type walks straight\n' +
      'through into the method that does not exist on it.\n\n' +
      'Fix it with one of:\n\n' +
      '    asText(f.izsledvania).trim()              // any shape -> string\n' +
      '    asList<Medication>(f.medications_list)    // any shape -> array\n' +
      '    if (Array.isArray(f.alergii)) …           // a real check\n\n' +
      'or, if the value genuinely cannot be a note field (a locally-built map that\n' +
      'happens to be keyed by field name), say so on the line:\n\n' +
      '    // shape-checked: <why this one cannot be wrong>\n'
  );
});
