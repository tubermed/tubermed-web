// scripts/list-date.test.ts — the амбулаторен лист is dated by the ПРЕГЛЕД,
// never by the clock (2026-08-27)
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
// A consultation recorded on 08.08.2026 was reopened on 27.08.2026 and the
// лист header printed „27.08.2026 г." — today. Every surface that carried a
// date computed it as `new Date()` at render time:
//
//   screen header  todayBg              app/app/scribe/result/page.tsx
//   PDF            handlePdf            → generatePdfHtml(f, dateStr)
//   Print          handlePrint          → generatePdfHtml(f, dateStr)
//   Word           handleWord           → generateWordHtml(f, dateStr)
//   Word filename  ambulatoren-list-<today>.doc
//   Echo PDF/Print handleEchoPdf/Print  → generateEchoHtml(f, dateStr)
//
// So a лист did not have a date at all: it had a rendering of the moment it
// was looked at. Reprint it in three months and it says three months from now.
// That field is mandatory on a legal medical record, it is what is reported to
// НЗОК, and it is the first thing an auditor checks.
//
// The stored data was never wrong. `extracted_fields` — the лист content blob —
// carries no date key of any kind (lib/types.ts TranscribeFields; backend
// routes/consultations.js returns it verbatim as `note`), and the row's own
// `created_at` was correct all along and already reaches the client. Nothing
// needed migrating: this was a render bug end to end, and binding the render to
// the row heals every existing note at once.
//
// ── THE INVARIANT ──────────────────────────────────────────────────────────
// ONE value, `listDateBg`, derived from the consultation's own stored
// timestamp, feeds the screen and all four export paths. It resolves in
// Europe/Sofia — not the browser's zone — so a visit recorded at 23:30 Sofia
// prints that day everywhere in the world, and one recorded at 00:30 Sofia
// prints the day it actually happened rather than the previous UTC day.
//
// When the timestamp is unknown the date is ABSENT, never substituted: a лист
// with a missing date is visibly incomplete, a лист with today's date is
// silently false, and only one of those is safe on a legal record.
//
// ── WHAT THIS GATE IS ──────────────────────────────────────────────────────
// Three halves. `formatVisitDateBg` / `sofiaDayIso` are real imports, exercised
// directly — including under a moved clock and a moved host timezone, because
// „the same row renders the same date whenever it is opened" is the whole
// claim and it is unfalsifiable without moving both. `lib/exporters.ts` is a
// pure module, called directly. The render bindings live in a React component
// a DOM-free `node --test` cannot mount, so those are SOURCE-TEXT predicates in
// the print-and-phone / source-label pattern — and section 6 feeds every one of
// them the code AS IT SHIPPED, so a green here is not decorative.
//
// Run: node --test scripts/list-date.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// registerHooks note: same local sync resolve hook as the sibling exporter
// tests — lib/exporters.ts uses extensionless relative imports.
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

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const RESULT    = read('app/app/scribe/result/page.tsx');
const EXPORTERS = read('lib/exporters.ts');

// Dynamic import so a MISSING export fails the assertion that needs it rather
// than the module link, which would take the source gates below down with it.
const { formatVisitDateBg, sofiaDayIso } = await import('../lib/date.ts');
const { generatePdfHtml, generateWordHtml, generateEchoHtml } =
  await import('../lib/exporters.ts');

// The лист that started this: recorded 08.08.2026, reopened 27.08.2026.
const AUG_8 = '2026-08-08T09:12:00.000Z';

// ── 1. The formatter — a stored timestamp in, the day of the преглед out ────

test('a stored timestamp renders as the day of the преглед', () => {
  assert.equal(formatVisitDateBg(AUG_8), '08.08.2026 г.');
});

test('two rows with different timestamps render different dates', () => {
  // „Prove it with two rows of known different timestamps." Nothing about the
  // output may come from when the test runs.
  assert.equal(formatVisitDateBg('2026-08-08T09:12:00.000Z'), '08.08.2026 г.');
  assert.equal(formatVisitDateBg('2026-06-21T14:00:00.000Z'), '21.06.2026 г.');
});

test('an unknown timestamp yields no date — never a substitute', () => {
  for (const bad of [null, undefined, '', '   ', 'not-a-date', 'сряда']) {
    assert.equal(formatVisitDateBg(bad as string | null | undefined), '',
      `expected '' for ${JSON.stringify(bad)} — a лист may be missing its date, never carry a false one`);
  }
});

test('sofiaDayIso gives the Sofia calendar day, ISO-shaped', () => {
  assert.equal(sofiaDayIso(AUG_8), '2026-08-08');
  assert.equal(sofiaDayIso(null), '');
  assert.equal(sofiaDayIso('not-a-date'), '');
});

// ── 2. Europe/Sofia, not UTC and not the browser's zone ────────────────────

test('23:30 Sofia does not print the next day (summer, UTC+3)', () => {
  // 2026-08-08 23:30 Sofia === 2026-08-08 20:30Z
  assert.equal(formatVisitDateBg('2026-08-08T20:30:00.000Z'), '08.08.2026 г.');
});

test('23:30 Sofia does not print the next day (winter, UTC+2)', () => {
  // 2026-01-15 23:30 Sofia === 2026-01-15 21:30Z
  assert.equal(formatVisitDateBg('2026-01-15T21:30:00.000Z'), '15.01.2026 г.');
});

test('00:30 Sofia prints the day it happened, not the previous UTC day', () => {
  // The direction that actually bites: 2026-08-09 00:30 Sofia === 08-08 21:30Z.
  // Read in UTC that is still the 8th; the преглед happened on the 9th.
  assert.equal(formatVisitDateBg('2026-08-08T21:30:00.000Z'), '09.08.2026 г.');
  // 2026-01-16 00:30 Sofia === 01-15 22:30Z
  assert.equal(formatVisitDateBg('2026-01-15T22:30:00.000Z'), '16.01.2026 г.');
});

test('the host timezone cannot move the лист date', () => {
  // A formatter with no `timeZone` follows the machine it runs on — which is
  // what the un-pinned control below demonstrates, so this is not a test that
  // passes because the assertion is weak.
  const control = (iso: string) =>
    new Intl.DateTimeFormat('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' })
      .format(new Date(iso));

  const midnightish = '2026-08-08T21:30:00.000Z'; // 00:30 Sofia on the 9th
  const original = process.env.TZ;
  const seen = new Set<string>();
  const controlSeen = new Set<string>();
  try {
    for (const tz of ['Europe/Sofia', 'America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
      process.env.TZ = tz;
      seen.add(formatVisitDateBg(midnightish));
      controlSeen.add(control(midnightish));
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
  assert.ok(controlSeen.size > 1,
    'control: an un-pinned formatter must drift with the host timezone, or this test proves nothing');
  assert.deepEqual([...seen], ['09.08.2026 г.']);
});

// ── 3. The clock may move; the date may not ────────────────────────────────

/** Run `fn` with the wall clock frozen at `iso`. `new Date(x)` still parses. */
function atClock<T>(iso: string, fn: () => T): T {
  const Real = globalThis.Date;
  const fixed = Real.parse(iso);
  class Frozen extends Real {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      if (args.length === 0) super(fixed);
      // @ts-expect-error — forwarding the real constructor's overloads
      else super(...args);
    }
    static now() { return fixed; }
  }
  globalThis.Date = Frozen as unknown as DateConstructor;
  try { return fn(); } finally { globalThis.Date = Real; }
}

test('the control: a clock-derived date DOES move when the clock moves', () => {
  // Without this, the next test is green for a formatter that ignores its
  // argument entirely. This is the bug, reproduced.
  const asShipped = () =>
    new Date().toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' });
  assert.equal(atClock('2026-08-27T08:00:00.000Z', asShipped), '27.08.2026 г.');
  assert.equal(atClock('2026-11-27T08:00:00.000Z', asShipped), '27.11.2026 г.');
});

test('the same row renders the same date today and in three months', () => {
  const opened_today  = atClock('2026-08-27T08:00:00.000Z', () => formatVisitDateBg(AUG_8));
  const opened_later  = atClock('2026-11-27T08:00:00.000Z', () => formatVisitDateBg(AUG_8));
  const opened_a_year = atClock('2027-08-27T08:00:00.000Z', () => formatVisitDateBg(AUG_8));
  assert.equal(opened_today, '08.08.2026 г.');
  assert.equal(opened_today, opened_later);
  assert.equal(opened_today, opened_a_year);
});

// ── 4. The exporters carry the date they are given, or none at all ─────────

const NOTE = { anamneza: 'Тест', osnovna_diagnoza: 'Тест', osnovna_mkb: 'J06.9' };
const ECHO = { zakljuchenie: 'Тест' };

test('a known date reaches every generated document', () => {
  const d = '08.08.2026 г.';
  assert.ok(generatePdfHtml(NOTE, d).includes('Дата: 08.08.2026 г.'),  'PDF/Print');
  assert.ok(generatePdfHtml(NOTE, d).includes('Амбулаторен лист — 08.08.2026 г.'), 'PDF title');
  assert.ok(generateWordHtml(NOTE, d).includes('Дата: 08.08.2026 г.'), 'Word');
  assert.ok(generateEchoHtml(ECHO, d).includes('08.08.2026 г.'),       'Echo');
});

test('an unknown date leaves no dangling „Дата:" label', () => {
  // Absent, not wrong, and not half-written either: „Дата: " with nothing
  // after it reads as a document that lost its date, which is a different
  // (and false) claim from a document that never had one to show.
  assert.ok(!generatePdfHtml(NOTE, '').includes('Дата:'), 'PDF/Print');
  assert.ok(!generateWordHtml(NOTE, '').includes('Дата:'), 'Word');
  assert.ok(!generatePdfHtml(NOTE, '').includes('Амбулаторен лист — <'), 'PDF title separator');
  assert.ok(!/Амбулаторен лист —\s*<\/title>/.test(generatePdfHtml(NOTE, '')), 'PDF title separator');
});

// The exact hole a refuter walked through. `!/new Date\(/` is a denylist of one
// spelling, and the class has at least six: `Date()` with no `new` is legal JS
// returning today, `Date.now()` never says „Date(" with a space in the right
// place, and `toLocaleDateString` / `Intl.DateTimeFormat` / `getFullYear()`
// never say it at all. Held here to the same class as the sibling gates, so
// there is ONE definition of „reaches for the clock" across the три date tests.
const DATE_MACHINERY =
  // ascii-safe: JS source identifiers in our own files, never Bulgarian input
  /\bDate\s*\(|\bDate\s*\.\s*(?:now|parse|UTC)|toLocaleDate|toLocaleTime|toLocaleString|DateTimeFormat|formatVisitDateBg|formatDateTimeBg|formatDateBg|sofiaDayIso|todaySofiaIso|getFullYear\(|getMonth\(|getDate\(/;

const withoutComments = (src: string) =>
  src.split('\n').filter((l) => !/^\s*(?:\/\/|\/\*|\*)/.test(l)).join('\n');

test('the exporters never invent a date of their own', () => {
  assert.ok(!DATE_MACHINERY.test(withoutComments(EXPORTERS)),
    'lib/exporters.ts must render the date it is handed and nothing else');
});

test('RED: the spellings the old one-spelling denylist let through', () => {
  const old = /new Date\(/;
  const mutations = [
    'const stamp = Date();',                                  // no `new` — returns today
    'const t = Date.now();',
    'const s = d.toLocaleDateString("bg-BG");',
    'const f = new Intl.DateTimeFormat("bg-BG").format(x);',
    'const y = x.getFullYear();',
    "import { todaySofiaIso } from './date';",
  ];
  for (const m of mutations) {
    assert.equal(old.test(m), false, `precondition: the old gate should have missed ${m}`);
    assert.ok(DATE_MACHINERY.test(withoutComments(m)), `still not caught: ${m}`);
  }
  // …and the one spelling the old gate DID catch is still caught.
  assert.ok(DATE_MACHINERY.test('const d = new Date();'));
});

// ── 5. The render bindings (source-text predicates; section 6 proves them) ──

/** Arguments of every `name(...)` CALL in `src` (import lines carry no paren),
 *  split on top-level commas so `fields as unknown as EchoFields` stays one. */
function callArgs(src: string, name: string): string[][] {
  const out: string[][] = [];
  const needle = name + '(';
  let from = 0;
  for (;;) {
    const i = src.indexOf(needle, from);
    if (i === -1) return out;
    from = i + needle.length;
    let depth = 1;
    let j = from;
    for (; j < src.length && depth > 0; j++) {
      const ch = src[j];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
    }
    const inner = src.slice(from, j - 1);
    const args: string[] = [];
    let d = 0;
    let start = 0;
    for (let k = 0; k < inner.length; k++) {
      const ch = inner[k];
      if (ch === '(' || ch === '[' || ch === '{') d++;
      else if (ch === ')' || ch === ']' || ch === '}') d--;
      else if (ch === ',' && d === 0) { args.push(inner.slice(start, k).trim()); start = k + 1; }
    }
    args.push(inner.slice(start).trim());
    out.push(args);
  }
}

/** `src` with whole-line comments dropped. A gate a COMMENT can trip is a gate
 *  that pressures the next reader into writing a worse comment — and the fix
 *  for this bug has to be able to quote the code it removed. Only full comment
 *  lines go; nothing inside a string literal is touched. */
const code = (src: string): string =>
  src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');

/** The ONE name every dated surface must read. */
const BINDING = 'listDateBg';
/** The state holding the consultation's own stored timestamp. */
const STAMP = 'visitCreatedAt';

const P = {
  /** No лист surface may synthesise a date from the clock.
   *
   *  A refuter broke the first version of this with a two-statement split —
   *  `const now = new Date(); now.toLocaleDateString('bg-BG', …)` — because it
   *  only matched the single-expression form. So the rule is now the CLASS,
   *  not the shape: outside the two lifecycle fallbacks that legitimately mean
   *  „just now" (an optimistic sealed_at / erased_at while the server answers),
   *  the лист renderer may not construct a clock Date at all. */
  noClockDate(src: string): boolean {
    const LIFECYCLE_OK = ['setSealedAt(', 'setErasedAt('];
    for (const line of code(src).split('\n')) {
      if (!/new Date\(\s*\)/.test(line)) continue;
      if (LIFECYCLE_OK.some((ok) => line.includes(ok))) continue;
      return false;
    }
    return true;
  },

  /** All five export call sites take the same binding as their date. */
  generatorsTakeListDate(src: string): boolean {
    const sites = [
      ...callArgs(src, 'generatePdfHtml'),
      ...callArgs(src, 'generateWordHtml'),
      ...callArgs(src, 'generateEchoHtml'),
    ];
    // PDF, Print, Word, Echo-PDF, Echo-Print. Fewer means a path was deleted
    // or renamed, and this predicate must not pass by having nothing to check.
    if (sites.length < 5) return false;
    return sites.every((a) => a[1] === BINDING);
  },

  /** The on-screen header renders that binding — and NOTHING ELSE that could
   *  be a date. A refuter added a second `<div>` next to it rendering
   *  `Intl.DateTimeFormat(...).format(new Date())` and the first version of
   *  this stayed green, because it only asked whether the right value was
   *  PRESENT. Presence is not exclusivity on a document header. */
  headerRendersListDate(src: string): boolean {
    // ascii-safe: matches a JS identifier in this repo's own source, never
    // note text, product copy or anything a doctor typed.
    if (/todayBg/.test(src)) return false;
    const i = src.indexOf("'Амбулаторен лист'");
    if (i === -1) return false;
    const header = src.slice(i, i + 900);
    if (!header.includes(`{${BINDING}}`)) return false;
    // No other date machinery inside the header block.
    if (/new Date\(|DateTimeFormat|toLocaleDate|formatDateBg|formatDateTimeBg/.test(header)) return false;
    return true;
  },

  /** The binding is EXACTLY formatVisitDateBg(visitCreatedAt) — the whole
   *  initialiser, not a substring of it. A refuter appended `|| wall`, which is
   *  literally „if we do not know, print today" on a legal record, and the
   *  substring test could not see it. Anchored to the end of the statement. */
  listDateFromVisit(src: string): boolean {
    const want = `const ${BINDING} = formatVisitDateBg(${STAMP});`;
    // WHOLE LINE, not a substring: `… formatVisitDateBg(visitCreatedAt) || wall;`
    // contains the substring and is the exact defect this gate exists to stop.
    return code(src).split('\n').some((l) => l.trim() === want);
  },

  /** EVERY writer of the visit timestamp, and no others.
   *
   *  The first version counted writers (>= 4) and checked each argument for
   *  `Date`. A refuter beat it three ways: a FIFTH writer whose argument was an
   *  identifier holding a clock value; a `?? generatedAtIso` fallback on an
   *  approved writer (substring `has()` still matched); and deleting the
   *  per-visit reset while adding a never-called decoy to keep the count up.
   *
   *  So this is now an exact set membership, not a floor: the four writers'
   *  arguments must be exactly these four expressions, in the file, once each.
   *  Anything else — a new source, a fallback, a rename — is red by default and
   *  has to be added here deliberately. */
  stampSourcesAreVisitFacts(src: string): boolean {
    const args = callArgs(code(src), `set${STAMP[0].toUpperCase()}${STAMP.slice(1)}`)
      .map((a) => a[0].trim());
    const EXPECTED = [
      'null',                                        // the per-visit reset
      'decision.pendingVisit?.created_at ?? null',   // painted staging context
      'recovery.pendingVisit.created_at ?? null',    // cold-start recovery
      'consultation.created_at ?? null',             // authoritative reconcile
    ];
    if (args.length !== EXPECTED.length) return false;
    const sorted = [...args].sort();
    return JSON.stringify(sorted) === JSON.stringify([...EXPECTED].sort());
  },

  /** The reset is ADJACENT to the rest of the per-visit teardown, so it cannot
   *  be quietly relocated out of the effect that runs on a ?visit= change. */
  resetSitsInTheTeardown(src: string): boolean {
    const c = code(src);
    const i = c.indexOf('setPendingVisit(null);');
    if (i === -1) return false;
    return c.slice(i, i + 400).includes(`set${STAMP[0].toUpperCase()}${STAMP.slice(1)}(null);`);
  },
};

test('no лист surface reads the wall clock for a date', () => {
  assert.ok(P.noClockDate(RESULT));
});

test('every export path is dated by the same visit-derived binding', () => {
  assert.ok(P.generatorsTakeListDate(RESULT));
});

test('the on-screen header is dated by that binding too', () => {
  assert.ok(P.headerRendersListDate(RESULT));
});

test('the binding is the consultation timestamp, formatted in one place', () => {
  assert.ok(P.listDateFromVisit(RESULT));
});

test('the visit timestamp is only ever written from a resolved visit', () => {
  assert.ok(P.stampSourcesAreVisitFacts(RESULT));
});

test('the Word filename is dated by the visit, not by the download', () => {
  assert.ok(/sofiaDayIso\(visitCreatedAt\)/.test(RESULT),
    'ambulatoren-list-<today>.doc named every reprint after the day it was reprinted');
});

// ── 6. Red proof — every predicate above, fed the code as it shipped ───────
// Verbatim from app/app/scribe/result/page.tsx at 6caf584, the commit this
// batch branches from. A text gate is worth exactly as much as its red proof.

const SHIPPED_HANDLERS = `
  const handleEchoPdf = useCallback(() => {
    if (isLocked) return;
    const dateStr = new Date().toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const html = generateEchoHtml(fields as unknown as EchoFields, dateStr);
  }, [fields, isLocked, showToast, signalExport]);

  const handleEchoPrint = useCallback(() => {
    const dateStr = new Date().toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const html = generateEchoHtml(fields as unknown as EchoFields, dateStr);
  }, [fields, isLocked, showToast, signalExport]);

  const handlePdf = useCallback(() => {
    const dateStr = new Date().toLocaleDateString('bg-BG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const html = generatePdfHtml(fields, dateStr, exportIdentity);
  }, [fields, isLocked, showToast, signalExport, exportIdentity]);

  const handleWord = useCallback(() => {
    const dateStr = new Date().toLocaleDateString('bg-BG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const html = generateWordHtml(fields, dateStr, exportIdentity);
    const filename =
      'ambulatoren-list-' +
      new Date().toISOString().slice(0, 10) +
      '.doc';
  }, [fields, isLocked, showToast, signalExport, exportIdentity]);

  const handlePrint = useCallback(() => {
    const dateStr = new Date().toLocaleDateString('bg-BG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const html = generatePdfHtml(fields, dateStr, exportIdentity);
  }, [fields, isLocked, showToast, signalExport, exportIdentity]);
`;

const SHIPPED_HEADER = `
  const todayBg = new Date().toLocaleDateString('bg-BG', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
            <h1>
              {isEcho ? 'Ехокардиографско изследване' : 'Амбулаторен лист'}
            </h1>
            <div className="text-sm tabular-nums">
              {todayBg}
            </div>
`;

/** The regression the reset guards: a stamp adopted from the clock. */
const CLOCK_STAMP = `
    setVisitCreatedAt(null);
    setVisitCreatedAt(new Date().toISOString());
    setVisitCreatedAt(recovery.pendingVisit.created_at ?? null);
    setVisitCreatedAt(consultation.created_at ?? null);
`;

/** The regression the ≥4 floor guards: the per-visit reset dropped, so an old
 *  date survives a same-route ?visit= change onto another consultation. */
const NO_RESET_STAMP = `
    setVisitCreatedAt(decision.pendingVisit?.created_at ?? null);
    setVisitCreatedAt(recovery.pendingVisit.created_at ?? null);
    setVisitCreatedAt(consultation.created_at ?? null);
`;

/** One export path left on the clock while the rest were fixed. */
const ONE_PATH_MISSED =
  SHIPPED_HANDLERS.replace(/dateStr/g, BINDING)
    .replace(`generateWordHtml(fields, ${BINDING}, exportIdentity)`,
             'generateWordHtml(fields, wordDate, exportIdentity)');

test('RED: the shipped handlers fail the clock predicate', () => {
  assert.equal(P.noClockDate(SHIPPED_HANDLERS), false);
});

test('RED: the shipped handlers fail the export-binding predicate', () => {
  assert.equal(P.generatorsTakeListDate(SHIPPED_HANDLERS), false);
});

test('RED: one export path left behind still fails the export-binding predicate', () => {
  assert.equal(P.generatorsTakeListDate(ONE_PATH_MISSED), false);
});

test('RED: deleting an export path does not make the predicate vacuously true', () => {
  const fourLeft = SHIPPED_HANDLERS.replace(/dateStr/g, BINDING)
    .replace(/const handlePrint[\s\S]*$/, '');
  assert.equal(P.generatorsTakeListDate(fourLeft), false);
});

test('RED: the shipped header fails the header predicate', () => {
  assert.equal(P.headerRendersListDate(SHIPPED_HEADER), false);
});

test('RED: the shipped file has no visit-derived binding', () => {
  assert.equal(P.listDateFromVisit(SHIPPED_HEADER + SHIPPED_HANDLERS), false);
});

test('RED: a formatter fed anything but the visit stamp fails', () => {
  assert.equal(P.listDateFromVisit(`const ${BINDING} = formatVisitDateBg(new Date().toISOString())`), false);
});

test('RED: the shipped file has no visit-stamp writers at all', () => {
  assert.equal(P.stampSourcesAreVisitFacts(SHIPPED_HANDLERS + SHIPPED_HEADER), false);
});

test('RED: a stamp taken from the clock fails', () => {
  assert.equal(P.stampSourcesAreVisitFacts(CLOCK_STAMP), false);
});

test('RED: dropping the per-visit reset fails', () => {
  assert.equal(P.stampSourcesAreVisitFacts(NO_RESET_STAMP), false);
});

test('RED: callArgs reads calls, not the import list', () => {
  // `generatePdfHtml,` on an import line has no paren and must not be counted
  // as a call site with a `undefined` second argument.
  const importOnly = `import {\n  generatePdfHtml,\n  generateWordHtml,\n} from '@/lib/exporters';`;
  assert.deepEqual(callArgs(importOnly, 'generatePdfHtml'), []);
  assert.deepEqual(
    callArgs(`generateEchoHtml(fields as unknown as EchoFields, ${BINDING})`, 'generateEchoHtml'),
    [['fields as unknown as EchoFields', BINDING]],
  );
});

// ── 7. Red proof, round 2 — the six mutations a refuter got past round 1 ────
// Round 1's red proofs all attacked the code AS IT SHIPPED, which is only half
// the job: a standing gate exists to stop a FUTURE edit, and every one of these
// six passed 30/30 against the round-1 predicates while re-dating the лист by
// the clock or by the wrong consultation. They run against the REAL file, so
// they stay honest as it changes.

/** Apply a mutation to the real source; fail loudly if it did not apply (a
 *  no-op replace would make the assertion below vacuous in a new way). */
function mutate(src: string, from: string, to: string): string {
  const out = src.replace(from, to);
  assert.notEqual(out, src, `mutation did not apply: ${from.slice(0, 60)}`);
  return out;
}

test('RED-2 (M1): a fifth stamp writer holding a clock value', () => {
  // The argument is an IDENTIFIER, so scanning it for `Date` sees nothing.
  const m = mutate(RESULT,
    'setVisitCreatedAt(consultation.created_at ?? null);',
    'const generatedAtIso = new Date().toISOString();\n        setVisitCreatedAt(generatedAtIso);');
  assert.equal(P.stampSourcesAreVisitFacts(m), false);
});

test('RED-2 (M2): „if we do not know it, use today" on the paint writer', () => {
  const m = mutate(RESULT,
    'setVisitCreatedAt(decision.pendingVisit?.created_at ?? null);',
    'setVisitCreatedAt(decision.pendingVisit?.created_at ?? new Date().toISOString());');
  assert.equal(P.stampSourcesAreVisitFacts(m), false);
});

test('RED-2 (M3): the same fallback on the authoritative reconcile writer', () => {
  const m = mutate(RESULT,
    'setVisitCreatedAt(consultation.created_at ?? null);',
    'setVisitCreatedAt(consultation.created_at ?? todayIso);');
  assert.equal(P.stampSourcesAreVisitFacts(m), false);
});

test('RED-2 (M4): the per-visit reset deleted, a decoy keeping the count up', () => {
  // Verbatim the regression this batch names: without the reset, a same-route
  // ?visit= change dates the note being opened with the previous one's day.
  const m = mutate(RESULT, '    setVisitCreatedAt(null);\n', '')
    .replace('const listDateBg =',
      'const clearStamp = () => setVisitCreatedAt(null);\n  void clearStamp;\n  const listDateBg =');
  assert.equal(P.resetSitsInTheTeardown(m), false);
});

test('RED-2 (M5): the clock fallback, split across two statements', () => {
  // `const now = new Date()` on one line, the format call on another — the
  // single-expression regex of round 1 could not see this, and `|| wall` slid
  // past a substring test. This is a FALSE DATE on a legal record.
  const m = mutate(RESULT,
    'const listDateBg = formatVisitDateBg(visitCreatedAt);',
    "const now = new Date();\n  const wall = now.toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' });\n"
    + '  const listDateBg = formatVisitDateBg(visitCreatedAt) || wall;');
  assert.equal(P.noClockDate(m), false, 'the clock must be caught');
  assert.equal(P.listDateFromVisit(m), false, 'the `|| wall` fallback must be caught');
});

test('RED-2 (M6): a SECOND date in the header, beside the right one', () => {
  const m = mutate(RESULT,
    '              {listDateBg}',
    "              {listDateBg}</div><div>{new Intl.DateTimeFormat('bg-BG').format(new Date())}");
  assert.equal(P.headerRendersListDate(m), false);
});

test('RED-2: the lifecycle exemption in noClockDate is narrow', () => {
  // setSealedAt/setErasedAt may hold an optimistic „just now" — nothing else
  // may, and the exemption must not be a hole the next date can climb through.
  assert.equal(P.noClockDate('const x = new Date().toISOString();'), false);
  assert.equal(P.noClockDate('setSealedAt(body?.sealed_at ?? new Date().toISOString());'), true);
  assert.equal(P.noClockDate('const d = new Date( );'), false);
});

test('RED-2: mutate() refuses a mutation that did not apply', () => {
  // Round 2's proofs run against the real file, so a stale search string would
  // silently turn every assertion above into „the unmutated file is red" —
  // which it is not. Fail loudly instead.
  assert.throws(() => mutate('abc', 'not-present', 'x'), /mutation did not apply/);
});

test('the per-visit reset sits inside the teardown', () => {
  assert.ok(P.resetSitsInTheTeardown(RESULT));
});
