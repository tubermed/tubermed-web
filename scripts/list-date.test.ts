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

test('the exporters never invent a date of their own', () => {
  assert.ok(!/new Date\(/.test(EXPORTERS),
    'lib/exporters.ts must render the date it is handed and nothing else');
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

/** The ONE name every dated surface must read. */
const BINDING = 'listDateBg';
/** The state holding the consultation's own stored timestamp. */
const STAMP = 'visitCreatedAt';

const P = {
  /** No лист surface may read the wall clock for a date. */
  noClockDate(src: string): boolean {
    return !/new Date\(\)\s*\.\s*toLocaleDateString/.test(src)
        && !/new Date\(\)\s*\.\s*toISOString\(\)\s*\.\s*slice/.test(src);
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

  /** The on-screen header renders that same binding, and `todayBg` is gone. */
  headerRendersListDate(src: string): boolean {
    // ascii-safe: matches a JS identifier in this repo's own source, never
    // note text, product copy or anything a doctor typed.
    if (/\btodayBg\b/.test(src)) return false;
    const i = src.indexOf("'Амбулаторен лист'");
    if (i === -1) return false;
    return src.slice(i, i + 600).includes(`{${BINDING}}`);
  },

  /** The binding is the consultation's timestamp, formatted once. */
  listDateFromVisit(src: string): boolean {
    return new RegExp(`const ${BINDING} = formatVisitDateBg\\(${STAMP}\\)`).test(src);
  },

  /** Every writer of that timestamp is an identity-resolved server fact —
   *  never the clock — and all four writers are present: the per-visit reset,
   *  the painted blob's staging context, cold-start recovery, and the
   *  authoritative reconcile. Miss the reset and a same-route ?visit= change
   *  dates the new лист with the previous consultation's day. */
  stampSourcesAreVisitFacts(src: string): boolean {
    const args = callArgs(src, `set${STAMP[0].toUpperCase()}${STAMP.slice(1)}`).map((a) => a[0]);
    if (args.length < 4) return false;
    // ascii-safe: `args` are JS expression fragments read out of this repo's
    // own source — identifiers and property paths, never Bulgarian text.
    if (args.some((a) => /\bDate\b/.test(a))) return false;
    const has = (frag: string) => args.some((a) => a.includes(frag));
    return args.includes('null')
        && has('decision.pendingVisit')
        && has('recovery.pendingVisit')
        && has('consultation.created_at');
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
