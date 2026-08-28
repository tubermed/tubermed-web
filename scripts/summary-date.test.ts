// scripts/summary-date.test.ts — „Резюме за пациента" is dated by the ПРЕГЛЕД,
// never by the clock (2026-08-28)
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
// The same defect as the амбулаторен лист, on the one document that leaves the
// building in the patient's hand. `components/PatientSummaryModal.tsx`
// buildPrintHtml opened with:
//
//   const dateStr = new Date().toLocaleDateString('bg-BG', { … });
//
// — the wall clock, with no `timeZone` either. A summary generated from a note
// recorded on 08.08 and printed on 27.08 handed the patient a sheet dated
// 27.08. The лист fix (552d5ba) deliberately left this out of scope; this is
// that scope, closed.
//
// ── THE ENUMERATION ────────────────────────────────────────────────────────
// „every path the summary can leave by" — measured, not assumed. There are
// three surfaces and only ONE of them ever carried a date:
//
//   screen     the modal body        renders NO date (label → textarea →
//                                    disclaimer; the header is a title + ×)
//   Печат/PDF  handlePrint           buildPrintHtml → openPdfPreview; print
//                                    and „save as PDF" are the SAME document,
//                                    there is no separate PDF builder here
//   Копирай    handleCopy            composeFinal(draft, disclaimer) — body +
//                                    disclaimer, no date anywhere
//
// So the defect had exactly one site, and the two dateless paths are PINNED
// below rather than left to accident: if a future edit puts a date on the
// screen or in the clipboard, this gate goes red and whoever wrote it has to
// bind it to the преглед deliberately. Adding one is a content change to a
// patient-facing document and is Dimitar's ruling, not a side effect.
//
// ── THE INVARIANT ──────────────────────────────────────────────────────────
// Same binding, same source, same helper as the лист — not a second pipeline.
// The result page already derives ONE value, `listDateBg =
// formatVisitDateBg(visitCreatedAt)`, from the consultation's own stored
// timestamp resolved in Europe/Sofia. The modal receives that value as
// `visitDateBg` and passes it through; it owns no date machinery at all.
//
// Absent, never wrong: when the timestamp is unknown `listDateBg` is '' and the
// whole `.date` block drops out of the document. There is no `|| today`
// fallback — the refuter's worst find on the лист round was exactly that shape,
// and it has an explicit red proof here at all three sites it could reappear
// (page prop, builder argument, inside the builder).
//
// ── WHAT THIS GATE IS ──────────────────────────────────────────────────────
// Two halves. `lib/patient-summary-doc.ts` is a pure module (that is WHY the
// builder was lifted out of the .tsx — a DOM-free `node --test` cannot mount
// React, and a print document nobody can call is a print document nobody can
// test), exercised directly under a moved clock and a moved host timezone. The
// bindings live in React and are SOURCE-TEXT predicates in the sibling
// list-date / source-label pattern — and section 5 feeds every one of them the
// code AS IT SHIPPED plus the mutations a refuter would try, so a green here is
// not decorative.
//
// Run: node --test scripts/summary-date.test.ts

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

const MODAL     = read('components/PatientSummaryModal.tsx');
const RESULT    = read('app/app/scribe/result/page.tsx');
const DOCSRC    = read('lib/patient-summary-doc.ts');
// The shared funnel every print and PDF in the app passes through. Read here
// because a gate that stops at its own three files does not cover its own
// claim — see P.sharedFunnelInventsNoDate.
const EXPORTERS = read('lib/exporters.ts');

// Dynamic import so a MISSING export fails the assertion that needs it rather
// than the module link, which would take the source gates below down with it.
const { buildPatientSummaryHtml } = await import('../lib/patient-summary-doc.ts');
const { formatVisitDateBg } = await import('../lib/date.ts');

// The note that started the лист round: recorded 08.08.2026, reopened later.
const AUG_8 = '2026-08-08T09:12:00.000Z';
const AUG_8_BG = '08.08.2026 г.';
const BODY = 'Прегледът мина добре.\n\nПийте много течности.';

/** `src` with whole-line comments dropped — a gate a COMMENT can trip pressures
 *  the next reader into writing a worse comment, and the fix for this bug has
 *  to be able to quote the code it removed. (It caught exactly that here: the
 *  new module's docstring quotes the `new Date()` line it deleted, and the
 *  first version of „the builder never invents a date" went red on the
 *  explanation rather than on any code.) */
const code = (src: string): string =>
  src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');

/** Run `fn` with the wall clock frozen at `iso`. `new Date(x)` still parses.
 *
 *  A Proxy, not the obvious `class Frozen extends Date`. The subclass is not a
 *  faithful Date: `Date()` called WITHOUT `new` is legal JS returning today as
 *  a string, and a class constructor throws on it — so the subclass version of
 *  this helper killed a mutation by TypeError instead of by assertion, which is
 *  an instrument reporting a pass it did not earn. `Date()` is exactly the
 *  spelling that slipped past the first round's denylist, so the instrument had
 *  to be able to execute it. */
function atClock<T>(iso: string, fn: () => T): T {
  const Real = globalThis.Date;
  const fixed = Real.parse(iso);
  const Frozen = new Proxy(Real, {
    construct(target, args: unknown[]) {
      return args.length === 0
        ? new target(fixed)
        : Reflect.construct(target, args);
    },
    apply() {
      // Date() with no `new` — a string, per spec, and today's.
      return new Real(fixed).toString();
    },
    get(target, prop, recv) {
      if (prop === 'now') return () => fixed;
      return Reflect.get(target, prop, recv);
    },
  });
  globalThis.Date = Frozen as unknown as DateConstructor;
  try { return fn(); } finally { globalThis.Date = Real; }
}

/** Run `fn` with the host timezone moved. */
function atZone<T>(tz: string, fn: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

// ── 1. The printed document carries the date it is handed ──────────────────

/** The text of the document's date cell — the ONLY place a summary shows a date.
 *
 *  Scoped on purpose, and it was NOT scoped at first: the earlier version of
 *  these assertions asked whether the expected date appeared ANYWHERE in the
 *  html, and three of them went green against the shipped builder. Its second
 *  parameter is `patientName`, so the date the test handed it was rendered into
 *  the `who` line — while the `.date` cell underneath still printed today.
 *  Presence is not placement, and a gate that only asks „is the right string in
 *  the file" certifies the defect it was written to catch. */
function dateCell(html: string): string | null {
  const m = /<div class="date">([\s\S]*?)<\/div>/.exec(html);
  return m ? m[1] : null;
}

/** The document with its `<style>` block removed — everything a patient can
 *  actually read. The stylesheet is full of digits (`A5`, `14mm`, `#1a1a2e`,
 *  `18px`) that would drown any digit-based assertion. */
function readable(html: string): string {
  return html.replace(/<style>[\s\S]*?<\/style>/g, '');
}

/** Every date-shaped run in the readable document, in ANY notation.
 *
 *  Shape-free ON PURPOSE, and this replaced three assertions that were not. The
 *  first version asked „no `class="date"`", „no `DD.MM.YYYY`", „no the word
 *  Дата" — all bound to the shape the fix happens to use. A refuter emitted
 *  `<div class="issued">2026-08-28</div>` on the absent path and all three
 *  stayed true: an ISO date, under a different class, with no Bulgarian
 *  anywhere. „Absent, never wrong" had been narrowed to „absent, never wrong in
 *  Bulgarian, in that one div".
 *
 *  BODY is deliberately digit-free so this can be exhaustive. Real summary text
 *  carries doses and counts; that is why this runs against a fixture and not
 *  against a note. */
function dateLikeRuns(html: string): string[] {
  const text = readable(html);
  const found = [
    ...text.matchAll(/\d{1,4}[.\-/]\d{1,2}[.\-/]\d{1,4}/g),   // 08.08.2026, 2026-08-28, 8/8/26
    ...text.matchAll(/\b\d{4}\b/g),                            // ascii-safe: a bare 4-digit year, digits only
    ...text.matchAll(/\d{1,2}:\d{2}/g),                        // a clock time
  ].map((m) => m[0]);
  return [...new Set(found)];
}

test('a known визит date reaches the printed summary', () => {
  assert.equal(dateCell(buildPatientSummaryHtml(BODY, AUG_8_BG)), AUG_8_BG,
    'the patient\'s sheet must show the day of the преглед');
});

test('two rows with different timestamps print different dates', () => {
  // Nothing about the output may come from when the test runs.
  const a = buildPatientSummaryHtml(BODY, formatVisitDateBg('2026-08-08T09:12:00.000Z'));
  const b = buildPatientSummaryHtml(BODY, formatVisitDateBg('2026-06-21T14:00:00.000Z'));
  assert.equal(dateCell(a), '08.08.2026 г.');
  assert.equal(dateCell(b), '21.06.2026 г.');
  assert.notEqual(a, b);
});

test('the summary body and disclaimer still reach the document unchanged', () => {
  // The date binding may not cost the document its content: this is the one
  // sheet the patient keeps, and its text is the whole point of it.
  const html = buildPatientSummaryHtml(BODY, AUG_8_BG);
  assert.ok(html.includes('Прегледът мина добре.'));
  assert.ok(html.includes('Пийте много течности.'));
  assert.ok(html.includes('<title>Резюме за пациента</title>'));
  assert.ok(html.includes('<h1>Резюме за пациента</h1>'));
});

// ── 2. Absent, never wrong ─────────────────────────────────────────────────

test('an unknown timestamp prints no date at all, in any notation', () => {
  const html = buildPatientSummaryHtml(BODY, '');
  assert.deepEqual(dateLikeRuns(html), [],
    'nothing date-shaped may survive anywhere a patient can read — not in Bulgarian, not in ISO, not under another class name');
  assert.ok(!html.includes('class="date"'),
    'the whole date block drops out — an empty grey line is a document that lost its date');
});

test('an unknown timestamp leaves no dangling „Дата:" label', () => {
  const html = buildPatientSummaryHtml(BODY, '');
  assert.ok(!html.includes('Дата'), 'no orphaned label');
  assert.ok(!/г\.\s*<\/div>/.test(html), 'no orphaned Bulgarian date suffix');
});

test('the whole absent chain: no stored timestamp → no date on the sheet', () => {
  for (const missing of [null, undefined, '', '   ', 'not-a-date']) {
    const html = buildPatientSummaryHtml(
      BODY,
      formatVisitDateBg(missing as string | null | undefined),
    );
    assert.deepEqual(dateLikeRuns(html), [],
      `expected no date for ${JSON.stringify(missing)} — a summary may be missing its date, never carry a false one`);
  }
});

test('a KNOWN timestamp puts exactly one date on the sheet, in the date cell', () => {
  // The other half of shape-freedom: not „the right date is present" but „the
  // right date is the ONLY one". A second, clock-derived line anywhere in the
  // document is the same defect wearing a different label.
  const html = buildPatientSummaryHtml(BODY, AUG_8_BG);
  assert.deepEqual(dateLikeRuns(html), ['08.08.2026', '2026']);
  assert.equal(dateCell(html), AUG_8_BG);
});

// ── 3. Europe/Sofia and a moving clock ─────────────────────────────────────

test('23:30 Sofia does not print the next day (summer, UTC+3)', () => {
  // 2026-08-08 23:30 Sofia === 2026-08-08 20:30Z
  const html = buildPatientSummaryHtml(BODY, formatVisitDateBg('2026-08-08T20:30:00.000Z'));
  assert.equal(dateCell(html), '08.08.2026 г.');
});

test('23:30 Sofia does not print the next day (winter, UTC+2)', () => {
  // 2026-01-15 23:30 Sofia === 2026-01-15 21:30Z
  const html = buildPatientSummaryHtml(BODY, formatVisitDateBg('2026-01-15T21:30:00.000Z'));
  assert.equal(dateCell(html), '15.01.2026 г.');
});

test('00:30 Sofia prints the day it happened, not the previous UTC day', () => {
  // 2026-08-09 00:30 Sofia === 08-08 21:30Z (summer, UTC+3)
  const summer = buildPatientSummaryHtml(BODY, formatVisitDateBg('2026-08-08T21:30:00.000Z'));
  assert.equal(dateCell(summer), '09.08.2026 г.');
  // 2026-01-16 00:30 Sofia === 01-15 22:30Z (winter, UTC+2)
  const winter = buildPatientSummaryHtml(BODY, formatVisitDateBg('2026-01-15T22:30:00.000Z'));
  assert.equal(dateCell(winter), '16.01.2026 г.');
});

test('the host timezone cannot move the printed date', () => {
  // The control proves the assertion is not weak: an un-pinned formatter DOES
  // follow the machine it runs on.
  const control = (iso: string) =>
    new Intl.DateTimeFormat('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' })
      .format(new Date(iso));

  const midnightish = '2026-08-08T21:30:00.000Z'; // 00:30 Sofia on the 9th
  const seen = new Set<string>();
  const controlSeen = new Set<string>();
  for (const tz of ['Europe/Sofia', 'America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
    atZone(tz, () => {
      const html = buildPatientSummaryHtml(BODY, formatVisitDateBg(midnightish));
      const m = /<div class="date">([^<]*)<\/div>/.exec(html);
      seen.add(m ? m[1] : '(none)');
      controlSeen.add(control(midnightish));
    });
  }
  assert.ok(controlSeen.size > 1,
    'control: an un-pinned formatter must drift with the host timezone, or this test proves nothing');
  assert.deepEqual([...seen], ['09.08.2026 г.']);
});

test('the control: a clock-derived date DOES move when the clock moves', () => {
  // This is the bug, reproduced — without it the next test is green for a
  // builder that ignores its argument entirely.
  const asShipped = () =>
    new Date().toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' });
  assert.equal(atClock('2026-08-27T08:00:00.000Z', asShipped), '27.08.2026 г.');
  assert.equal(atClock('2026-11-27T08:00:00.000Z', asShipped), '27.11.2026 г.');
});

test('the same note prints the same date today, in three months, in a year', () => {
  const build = () => buildPatientSummaryHtml(BODY, formatVisitDateBg(AUG_8));
  const today = atClock('2026-08-27T08:00:00.000Z', build);
  const later = atClock('2026-11-27T08:00:00.000Z', build);
  const year  = atClock('2027-08-27T08:00:00.000Z', build);
  assert.equal(dateCell(today), AUG_8_BG);
  assert.equal(today, later);
  assert.equal(today, year);
});

test('the builder never invents a date of its own', () => {
  assert.ok(!/new Date\(|Date\.now\(|toLocaleDate|toLocaleString|DateTimeFormat/.test(code(DOCSRC)),
    'lib/patient-summary-doc.ts must render the date it is handed and nothing else');
});

// ── 4. The bindings (source-text predicates; section 5 proves them) ────────

/** Arguments of every `name(...)` CALL in `src` (import lines carry no paren),
 *  split on top-level commas. */
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

/** The full OPENING tag of `<Name …>`, brace-depth aware so it ends at that
 *  tag's own `>` whether the element is self-closing or not.
 *
 *  Scoping matters here and has bitten us: a sibling gate looked for the next
 *  `/>`, which on a non-self-closing element runs straight past the end of the
 *  tag and reports the NEIGHBOURING element's props as this one's. Depth
 *  tracking also steps over the `>` in `onClose={() => …}`. */
function openTag(src: string, name: string): string | null {
  const i = src.indexOf('<' + name);
  if (i === -1) return null;
  let depth = 0;
  for (let j = i + 1; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '<' && depth === 0) return null; // a new element opened first
    else if (ch === '>' && depth === 0) return src.slice(i, j + 1);
  }
  return null;
}

/** The pure builder the print path must go through. */
const DOC = 'buildPatientSummaryHtml';
/** The modal's date prop. */
const PROP = 'visitDateBg';
/** The result page's ONE date value. */
const BINDING = 'listDateBg';
/** The state holding the consultation's own stored timestamp. */
const STAMP = 'visitCreatedAt';

/** Every way a file could make itself a date. ONE list, shared by the modal,
 *  the builder module and the shared export funnel — they used to be two lists
 *  that disagreed, and the narrower one let a fallback through.
 *
 *  `\bDate\s*\(` rather than `new Date\(`: **`Date()` without `new` is legal
 *  JS** returning today as a string, and `String(Date()).slice(4, 15)` walked
 *  past round 1's denylist into the `.date` cell of a document handed to a
 *  patient. A denylist of SPELLINGS is not a rule about dates; this is the
 *  constructor itself, however it is invoked.
 *
 *  Every \b here is matched against JS source identifiers in this repo's own
 *  files — never against note text, product copy or doctor input. */
const DATE_MACHINERY =
  // ascii-safe: JS source identifiers in our own files, never Bulgarian input
  /\bDate\s*\(|\bDate\s*\.\s*(now|parse|UTC)|toLocaleDate|toLocaleTime|toLocaleString|DateTimeFormat|formatVisitDateBg|formatDateTimeBg|formatDateBg|sofiaDayIso|todaySofiaIso|getFullYear\(|getMonth\(|getDate\(/;

/** The ways a document can leave this modal. Named so the gate binds the EXITS
 *  and not just the builder: round 1 counted calls to `buildPatientSummaryHtml`
 *  and to `copyToClipboard`, so a second `openPdfPreview(myOwnHtml)` and a
 *  `navigator.clipboard.writeText(text + today)` both walked out of a file the
 *  gate believed it had enumerated. */
const FOREIGN_EXITS =
  /navigator\s*\.\s*clipboard|execCommand|window\s*\.\s*open|document\s*\.\s*write|createObjectURL|downloadWord|<a\s+download/;

const P = {
  /** The modal constructs no date. Not „not with the clock" — none at all: its
   *  date arrives as a prop already resolved in Europe/Sofia, so ANY date
   *  machinery inside this file is a second pipeline by definition. This is
   *  the CLASS, so the two-statement split that beat the лист gate's first
   *  version (`const now = new Date(); now.toLocaleDateString(…)`) is red here
   *  on either half. It is also what pins the SCREEN as dateless. */
  modalOwnsNoDate(src: string): boolean {
    return !DATE_MACHINERY.test(code(src));
  },

  /** The print document is built by the pure module, not re-declared locally —
   *  otherwise section 1–3 test a function that does not ship. */
  builderIsImported(src: string): boolean {
    const c = code(src);
    // Every \b below sits against a JS IDENTIFIER in this repo's own source —
    // buildPatientSummaryHtml, buildPrintHtml, the import specifier — never
    // against note text, product copy or anything a doctor typed, so the ASCII
    // word boundary means exactly what it says here.
    if (new RegExp(`(function|const)\\s+${DOC}\\b`).test(c)) return false; // ascii-safe: JS identifier
    if (/function\s+buildPrintHtml\b/.test(c)) return false; // ascii-safe: JS identifier
    // ascii-safe: JS identifier inside an import specifier
    return new RegExp(`import\\s*\\{[^}]*\\b${DOC}\\b[^}]*\\}\\s*from\\s*'@/lib/patient-summary-doc'`)
      .test(c);
  },

  /** The ONE call site's arguments are EXACTLY these two names — and there is
   *  no third.
   *
   *  Round 1 checked argument 1 alone, and a refuter went round it twice
   *  without touching it: once by prepending „Отпечатано: <today>" to argument
   *  0 (the whole document body), once by passing a clock string as argument 2,
   *  which was `patientName` and rendered the `who` line directly above the
   *  date cell. Binding one argument of a document builder is not binding the
   *  document.
   *
   *  Argument 2 is now gone from the builder entirely — it was a dead
   *  patient-identity channel into a patient-facing printed sheet — so the
   *  exact-arity check keeps that route closed here as well as in
   *  scripts/document-identity.test.ts. */
  printTakesVisitDate(src: string): boolean {
    const sites = callArgs(code(src), DOC);
    if (sites.length !== 1) return false;
    return JSON.stringify(sites[0]) === JSON.stringify(['finalText', PROP]);
  },

  /** The prop is never shadowed. `printTakesVisitDate` reads an identifier
   *  NAME, and a refuter re-bound that name inside handlePrint —
   *  `const visitDateBg = stampedDate || String(Date()).slice(4, 15);` — so the
   *  call site still read `visitDateBg` while printing the wall clock. A name
   *  check is only a value check while the name means one thing. */
  propIsNeverRebound(src: string): boolean {
    const c = code(src);
    return !new RegExp(`(const|let|var)\\s+${PROP}\\b|${PROP}\\s*=[^=>]`).test(c); // ascii-safe: JS identifier
  },

  /** The document leaves by exactly ONE door, and that door is handed exactly
   *  the builder's output. Everything else that could push bytes at a printer,
   *  a clipboard or a disk is forbidden outright. */
  oneWayOut(src: string): boolean {
    const c = code(src);
    if (FOREIGN_EXITS.test(c)) return false;
    const opens = callArgs(c, 'openPdfPreview');
    if (opens.length !== 1) return false;
    return opens[0][0] === `${DOC}(finalText, ${PROP})`;
  },

  /** The modal builds no document of its own. `builderIsImported` forbids two
   *  NAMES; this forbids the whole activity, so a fresh local `buildSheetHtml`
   *  emitting its own `<div class="date">` has nowhere to hide. */
  modalBuildsNoDocument(src: string): boolean {
    return !/<!doctype|<style|class="date"|<html/i.test(code(src));
  },

  /** The prop is REQUIRED and a plain string — an optional one lets a future
   *  call site omit it and lose the date silently, which is the лист bug with
   *  a nicer diff. Declared in the interface AND destructured in the signature,
   *  because either alone is a prop that is typed but never read. */
  propIsRequired(src: string): boolean {
    const c = code(src);
    if (!/^\s*visitDateBg: string;\s*$/m.test(c)) return false;
    if (/visitDateBg\?/.test(c)) return false;
    const sig = c.slice(c.indexOf('export default function PatientSummaryModal('));
    return /^\s*visitDateBg,\s*$/m.test(sig.slice(0, 400));
  },

  /** The clipboard path is DATELESS, pinned: it copies the composed body +
   *  disclaimer and nothing else. A date here would be new content on a
   *  patient-facing document — allowed only by a ruling, never as a side effect
   *  of a date batch.
   *
   *  The composition is checked as a WHOLE LINE rather than by argument list.
   *  Two reasons, both learned the hard way: `callArgs` counts a function's own
   *  DECLARATION as a call site (`function composeFinal(body: string, …)` has a
   *  paren too), which made the first version of this predicate red on correct
   *  code; and an anchored statement is the only form that also rejects
   *  `composeFinal(draft, disclaimer) + visitDateBg`. */
  clipboardCarriesNoDate(src: string): boolean {
    const c = code(src);
    const copies = callArgs(c, 'copyToClipboard');
    if (copies.length !== 1 || copies[0][0] !== 'finalText') return false;
    return c.split('\n').some(
      (l) => l.trim() === 'const finalText = composeFinal(draft, disclaimer);',
    );
  },

  /** The result page hands the modal its ONE date value — the same binding the
   *  лист header and all five export paths read.
   *
   *  An EXACT prop set, not a presence check, and the element is counted. Round
   *  1 asked „does the first `<PatientSummaryModal>` carry the right prop, and
   *  no date machinery beside it". A refuter answered yes twice over: a SECOND
   *  element after the real one (indexOf reads the first and stops), and
   *  `patientName={issuedLine}` where `issuedLine` was built from the clock
   *  three lines up, so the tag itself was innocent. Anything not on this list
   *  is red by default and has to be added here on purpose. */
  pageBindsTheListDate(src: string): boolean {
    const c = code(src);
    const mounts = c.split('<PatientSummaryModal').length - 1;
    if (mounts !== 1) return false;
    const tag = openTag(c, 'PatientSummaryModal');
    if (!tag) return false;
    if (DATE_MACHINERY.test(tag)) return false;
    if (!tag.includes(`${PROP}={${BINDING}}`)) return false;
    const props = [...tag.matchAll(/(\w+)=\{/g)].map((m) => m[1]); // ascii-safe: JSX prop names
    const EXPECTED = ['isOpen', 'consultationId', 'onClose', 'onToast', PROP];
    return JSON.stringify([...props].sort()) === JSON.stringify([...EXPECTED].sort());
  },

  /** The upstream binding, asserted HERE and not only in the sibling gate.
   *
   *  Deleting the per-visit reset `setVisitCreatedAt(null)` — which is what
   *  stops consultation A's day surviving a same-route `?visit=` change to B —
   *  left this whole file green while list-date.test.ts went red. A gate that
   *  inherits its safety from another file certifies a claim it cannot check:
   *  if that file is ever weakened, this one alone would still pass a summary
   *  dated by the previous consultation. Same two assertions, deliberately
   *  duplicated. */
  stampIsTheConsultationsOwn(src: string): boolean {
    const c = code(src);
    const want = `const ${BINDING} = formatVisitDateBg(${STAMP});`;
    if (!c.split('\n').some((l) => l.trim() === want)) return false;
    const args = callArgs(c, `set${STAMP[0].toUpperCase()}${STAMP.slice(1)}`).map((a) => a[0].trim());
    const EXPECTED = [
      'null',                                        // the per-visit reset
      'decision.pendingVisit?.created_at ?? null',   // painted staging context
      'recovery.pendingVisit.created_at ?? null',    // cold-start recovery
      'consultation.created_at ?? null',             // authoritative reconcile
    ];
    return JSON.stringify([...args].sort()) === JSON.stringify([...EXPECTED].sort());
  },

  /** The SHARED funnel. Every print and PDF in the app — лист, echo, and this
   *  summary — goes through `openPdfPreview` in lib/exporters.ts, and round 1
   *  never read that file at all. A refuter added six lines there that stamped
   *  a corner date onto every document the product emits, and 375/375 stayed
   *  green. The sibling gate reads it but only bans `new Date(`, which is not
   *  the class. */
  sharedFunnelInventsNoDate(src: string): boolean {
    return !DATE_MACHINERY.test(code(src));
  },
};

test('the patient summary modal owns no date machinery of its own', () => {
  assert.ok(P.modalOwnsNoDate(MODAL));
});

test('the printable summary is built by the pure module that is tested above', () => {
  assert.ok(P.builderIsImported(MODAL));
});

test('the print path is dated by the visit, not by the clock', () => {
  assert.ok(P.printTakesVisitDate(MODAL));
});

test('the date prop is required, so no call site can drop it silently', () => {
  assert.ok(P.propIsRequired(MODAL));
});

test('the clipboard path carries no date (pinned — adding one needs a ruling)', () => {
  assert.ok(P.clipboardCarriesNoDate(MODAL));
});

test('the date prop is never rebound inside the modal', () => {
  assert.ok(P.propIsNeverRebound(MODAL));
});

test('the summary leaves by exactly one door, carrying the built document', () => {
  assert.ok(P.oneWayOut(MODAL));
});

test('the modal builds no document of its own', () => {
  assert.ok(P.modalBuildsNoDocument(MODAL));
});

test('the result page hands the summary the same binding the лист uses', () => {
  assert.ok(P.pageBindsTheListDate(RESULT));
});

test('the binding upstream of the prop is the consultation\'s own timestamp', () => {
  assert.ok(P.stampIsTheConsultationsOwn(RESULT));
});

test('the shared print funnel stamps no date onto any document', () => {
  assert.ok(P.sharedFunnelInventsNoDate(EXPORTERS));
});

// ── 5. Red proof — every predicate above, against the shipped code and the
//       mutations a refuter would reach for ────────────────────────────────
// Verbatim from components/PatientSummaryModal.tsx at 19be4c8, the commit this
// batch branches from. A text gate is worth exactly as much as its red proof.

const SHIPPED_BUILDER = `
function buildPrintHtml(summary: string, patientName?: string): string {
  const dateStr = new Date().toLocaleDateString('bg-BG', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const who = patientName ? \`<div class="who">\${escapeHtml(patientName)}</div>\` : '';
  return \`<h1>Резюме за пациента</h1>
\${who}
<div class="date">\${dateStr}</div>\`;
}
`;

const SHIPPED_CALL = `
  function handlePrint() {
    const opened = openPdfPreview(buildPrintHtml(finalText, patientName), { autoPrint: true });
  }
`;

const SHIPPED_TAG = `
      <PatientSummaryModal
        isOpen={summaryOpen}
        consultationId={original.consultationId}
        onClose={() => setSummaryOpen(false)}
        onToast={showToast}
      />
`;

/** The fixed file with the date re-derived from the clock, split across two
 *  statements — the shape that beat the лист gate's first version. */
const TWO_STATEMENT_CLOCK = `
  function handlePrint() {
    const now = new Date();
    const wall = now.toLocaleDateString('bg-BG');
    const opened = openPdfPreview(${DOC}(finalText, ${PROP}), { autoPrint: true });
  }
`;

test('RED: the shipped builder fails the no-date-machinery predicate', () => {
  assert.equal(P.modalOwnsNoDate(SHIPPED_BUILDER), false);
});

test('RED: a two-statement clock re-derivation still fails it', () => {
  assert.equal(P.modalOwnsNoDate(TWO_STATEMENT_CLOCK), false);
});

test('RED: re-formatting the visit stamp inside the modal fails it too', () => {
  // A second pipeline, even a correct-looking one: the page already resolved
  // this value once, and two formatters are two things to keep in agreement.
  assert.equal(
    P.modalOwnsNoDate(`const d = formatVisitDateBg(visitCreatedAt);`),
    false,
  );
});

test('RED: a comment is NOT enough to trip the predicate', () => {
  // The inverse failure: a gate a comment can redden is a gate that pressures
  // the next reader into deleting the explanation.
  assert.equal(P.modalOwnsNoDate(`// this used to be new Date().toLocaleDateString()\nconst x = 1;`), true);
});

test('RED: the shipped file declares its own builder, so the import predicate fails', () => {
  assert.equal(P.builderIsImported(SHIPPED_BUILDER + SHIPPED_CALL), false);
});

test('RED: re-declaring the builder locally beside a real import still fails', () => {
  const both =
    `import { ${DOC} } from '@/lib/patient-summary-doc';\n` +
    `function ${DOC}(summary: string, dateBg: string) { return ''; }\n`;
  assert.equal(P.builderIsImported(both), false);
});

test('RED: the shipped call site fails the visit-date predicate', () => {
  assert.equal(P.printTakesVisitDate(SHIPPED_CALL), false);
});

test('RED: „|| wall" on the builder argument fails — the fallback IS the defect', () => {
  const mutated = `openPdfPreview(${DOC}(finalText, ${PROP} || wall), { autoPrint: true });`;
  assert.equal(P.printTakesVisitDate(mutated), false);
});

test('RED: „?? today" on the builder argument fails as well', () => {
  const mutated = `openPdfPreview(${DOC}(finalText, ${PROP} ?? todayBg), {});`;
  assert.equal(P.printTakesVisitDate(mutated), false);
});

test('RED: deleting the call site does not make the predicate vacuously true', () => {
  assert.equal(P.printTakesVisitDate(`function handlePrint() {}`), false);
});

test('RED: a SECOND print call site fails — one document, one date', () => {
  const two =
    `openPdfPreview(${DOC}(finalText, ${PROP}), {});\n` +
    `openPdfPreview(${DOC}(finalText, ${PROP}), {});`;
  assert.equal(P.printTakesVisitDate(two), false);
});

test('RED: callArgs reads calls, not the import list', () => {
  const importOnly = `import {\n  ${DOC},\n} from '@/lib/patient-summary-doc';`;
  assert.deepEqual(callArgs(importOnly, DOC), []);
  assert.deepEqual(
    callArgs(`${DOC}(finalText, ${PROP}, extra)`, DOC),
    [['finalText', PROP, 'extra']],
  );
});

test('RED: an OPTIONAL date prop fails the required-prop predicate', () => {
  const optional = `
interface PatientSummaryModalProps {
  visitDateBg?: string;
}
export default function PatientSummaryModal({
  visitDateBg,
}: PatientSummaryModalProps) {}
`;
  assert.equal(P.propIsRequired(optional), false);
});

test('RED: a prop declared but never destructured fails too', () => {
  const declaredOnly = `
interface PatientSummaryModalProps {
  visitDateBg: string;
}
export default function PatientSummaryModal({
  onToast,
}: PatientSummaryModalProps) {}
`;
  assert.equal(P.propIsRequired(declaredOnly), false);
});

test('RED: the shipped tag has no date prop at all', () => {
  assert.equal(P.pageBindsTheListDate(SHIPPED_TAG), false);
});

test('RED: „|| wall" on the PAGE prop fails — the same defect, one file up', () => {
  const mutated = SHIPPED_TAG.replace('onToast={showToast}',
    `onToast={showToast}\n        ${PROP}={${BINDING} || wall}`);
  assert.equal(P.pageBindsTheListDate(mutated), false);
});

test('RED: a clock-derived prop on the page fails', () => {
  const mutated = SHIPPED_TAG.replace('onToast={showToast}',
    `onToast={showToast}\n        ${PROP}={formatVisitDateBg(new Date().toISOString())}`);
  assert.equal(P.pageBindsTheListDate(mutated), false);
});

test('RED: the tag scan stops at its own „>" and cannot read a neighbour prop', () => {
  // The scoping failure this predicate exists to avoid: a non-self-closing tag
  // followed by a SIBLING that does carry the right prop must not go green.
  const neighbour = `
      <PatientSummaryModal isOpen={summaryOpen}></PatientSummaryModal>
      <SomethingElse ${PROP}={${BINDING}} />
`;
  assert.equal(P.pageBindsTheListDate(neighbour), false);
  // …and a non-self-closing tag that DOES carry the full prop set is green, so
  // the scan is strict about the right thing and not simply always-red.
  const correct = `
      <PatientSummaryModal
        isOpen={summaryOpen}
        consultationId={original.consultationId}
        onClose={() => setSummaryOpen(false)}
        onToast={showToast}
        ${PROP}={${BINDING}}
      ></PatientSummaryModal>
      <SomethingElse />
`;
  assert.equal(P.pageBindsTheListDate(correct), true);
});

test('RED: a clipboard path that composes in a date fails the dateless pin', () => {
  const dated = `
    const finalText = composeFinal(draft, disclaimer, visitDateBg);
    const ok = await copyToClipboard(finalText);
`;
  assert.equal(P.clipboardCarriesNoDate(dated), false);
  const appended = `
    const finalText = composeFinal(draft, disclaimer);
    const ok = await copyToClipboard(finalText + visitDateBg);
`;
  assert.equal(P.clipboardCarriesNoDate(appended), false);
  // …and the honest shape IS green, so the pin is not simply always-red.
  const correct = `
    const finalText = composeFinal(draft, disclaimer);
    const ok = await copyToClipboard(finalText);
`;
  assert.equal(P.clipboardCarriesNoDate(correct), true);
});

test('RED: callArgs counts a DECLARATION as a call — which is why the pin is a whole line', () => {
  // The self-inflicted red that produced the current predicate: composeFinal's
  // own `function composeFinal(body: string, disclaimer: string)` is a `name(`
  // occurrence, so an argument-list check saw two "call sites" on correct code.
  const decl = `function composeFinal(body: string, disclaimer: string): string {}`;
  assert.equal(callArgs(decl, 'composeFinal').length, 1);
  assert.deepEqual(callArgs(decl, 'composeFinal'), [['body: string', 'disclaimer: string']]);
});

// ── 5b. Red proof, round 2 — the seven mutations a refuter got past round 1 ─
// Every one of these passed 45/45 AND 375/375 with a clean `npx tsc --noEmit`,
// and five of them re-dated the `.date` cell or the document body of a sheet
// handed to a patient. Round 1's red proofs all attacked the code AS IT
// SHIPPED, which is only half the job: a standing gate exists to stop a FUTURE
// edit. These are that half.

test('R2/1: a corner date stamped into the SHARED print funnel', () => {
  // lib/exporters.ts openPdfPreview — one edit re-dates лист, echo AND summary.
  // Round 1 never read this file; the sibling gate reads it but bans only
  // `new Date(`, which `todaySofiaIso()` is not.
  const mutated = `
export function openPdfPreview(html: string, opts?: OpenPreviewOpts): boolean {
  const win = window.open('', '_blank');
  const stamp = '<div style="position:fixed;top:4mm">' + todaySofiaIso() + '</div>';
  const finalHtml = html.replace('</body>', stamp + closeScript + '</body>');
}`;
  assert.equal(P.sharedFunnelInventsNoDate(mutated), false);
});

test('R2/2: the prop rebound inside handlePrint, hiding a bare Date()', () => {
  // `Date()` with no `new` — legal JS, returns today as a string, and matched
  // neither `new Date\(` nor `Date\.now\(` in round 1's denylist.
  const mutated = `
  const stampedDate = ${PROP};
  function handlePrint() {
    const ${PROP} = stampedDate || String(Date()).slice(4, 15);
    const opened = openPdfPreview(${DOC}(finalText, ${PROP}), { autoPrint: true });
  }`;
  assert.equal(P.propIsNeverRebound(mutated), false, 'the shadowing');
  assert.equal(P.modalOwnsNoDate(mutated), false, 'and the bare Date() behind it');
});

test('R2/2b: bare Date() is caught wherever it appears', () => {
  for (const shape of ['Date()', 'Date ()', 'String(Date())', 'new Date()', 'Date.now()', 'Date.parse(x)']) {
    assert.equal(P.modalOwnsNoDate(`const x = ${shape};`), false, shape);
  }
});

test('R2/3: a clock date prepended to the document BODY (argument 0)', () => {
  const mutated = `
  function handlePrint() {
    const printed = finalText + 'Отпечатано: ' + String(Date()).slice(4, 15);
    const opened = openPdfPreview(${DOC}(printed, ${PROP}), { autoPrint: true });
  }`;
  assert.equal(P.printTakesVisitDate(mutated), false, 'argument 0 is bound too');
  assert.equal(P.modalOwnsNoDate(mutated), false);
});

test('R2/4: a whole second pipeline — its own builder, print and copy exits', () => {
  const mutated = `
  function buildSheetHtml(summary: string): string {
    return '<div class="date">' + String(Date()).slice(4, 15) + '</div>';
  }
  function handleReprint() {
    openPdfPreview(buildSheetHtml(finalText), { autoPrint: true });
  }
  function handleCopyWithDate() {
    navigator.clipboard.writeText(finalText + ' — ' + String(Date()));
  }
  function handlePrint() {
    const opened = openPdfPreview(${DOC}(finalText, ${PROP}), { autoPrint: true });
  }`;
  assert.equal(P.oneWayOut(mutated), false, 'two print exits and a foreign clipboard exit');
  assert.equal(P.modalBuildsNoDocument(mutated), false, 'and it builds its own document');
  assert.equal(P.modalOwnsNoDate(mutated), false);
});

test('R2/4b: a foreign exit alone is enough to fail, with no date in sight', () => {
  const mutated = `
  function handleCopy() {
    navigator.clipboard.writeText(finalText);
  }
  function handlePrint() {
    const opened = openPdfPreview(${DOC}(finalText, ${PROP}), { autoPrint: true });
  }`;
  assert.equal(P.oneWayOut(mutated), false,
    'the exits are enumerated, not merely inspected for dates — an unpinned door is the hazard');
});

test('R2/5: the builder\'s own fallback, in ISO, under a different class name', () => {
  // `<div class="issued">2026-08-28</div>` on the absent path. All three of
  // round 1's absent-case assertions stayed true: no `class="date"`, no
  // `DD.MM.YYYY`, no „Дата". The module denylist was also five names narrower
  // than the modal's, so `todaySofiaIso()` was invisible there.
  const mutantSrc = `
export function ${DOC}(summary: string, dateBg: string): string {
  const dateHtml = dateBg
    ? \`<div class="date">\${dateBg}</div>\`
    : \`<div class="issued">\${todaySofiaIso()}</div>\`;
  return dateHtml;
}`;
  assert.equal(P.sharedFunnelInventsNoDate(mutantSrc), false,
    'one shared DATE_MACHINERY — the module is held to the modal\'s standard');
  // …and the behavioural half now catches the OUTPUT too, whatever it is called.
  const mutantOut = '<div class="issued">2026-08-28</div><div class="text">Тест</div>';
  assert.deepEqual(dateLikeRuns(mutantOut), ['2026-08-28', '2026']);
});

test('R2/6: a SECOND <PatientSummaryModal> after the correct one', () => {
  const mutated = `
      <PatientSummaryModal
        isOpen={summaryOpen}
        consultationId={original.consultationId}
        onClose={() => setSummaryOpen(false)}
        onToast={showToast}
        ${PROP}={${BINDING}}
      />
      <PatientSummaryModal
        isOpen={reprintOpen}
        consultationId={original.consultationId}
        onClose={() => setReprintOpen(false)}
        onToast={showToast}
        ${PROP}={reprintDateBg}
      />`;
  assert.equal(P.pageBindsTheListDate(mutated), false, 'the element is counted, not indexOf-ed');
});

test('R2/7: any extra prop fails — the identity channel cannot come back', () => {
  const mutated = `
      <PatientSummaryModal
        isOpen={summaryOpen}
        consultationId={original.consultationId}
        onClose={() => setSummaryOpen(false)}
        onToast={showToast}
        ${PROP}={${BINDING}}
        patientName={issuedLine}
      />`;
  assert.equal(P.pageBindsTheListDate(mutated), false,
    'the prop SET is exact. `patientName` was a real prop when this was written, and a clock ' +
    'string passed through it rendered above the date cell; the prop is deleted now, and this ' +
    'is what stops it — or any other new channel into the sheet — being added back here');
});

test('R2/8: deleting the per-visit reset fails THIS gate too, not just the sibling', () => {
  const noReset = `
  const ${BINDING} = formatVisitDateBg(${STAMP});
  setVisitCreatedAt(decision.pendingVisit?.created_at ?? null);
  setVisitCreatedAt(recovery.pendingVisit.created_at ?? null);
  setVisitCreatedAt(consultation.created_at ?? null);`;
  assert.equal(P.stampIsTheConsultationsOwn(noReset), false,
    'without the reset, consultation A\'s day survives a ?visit= change to B');
  const clockStamp = `
  const ${BINDING} = formatVisitDateBg(${STAMP});
  setVisitCreatedAt(null);
  setVisitCreatedAt(new Date().toISOString());
  setVisitCreatedAt(recovery.pendingVisit.created_at ?? null);
  setVisitCreatedAt(consultation.created_at ?? null);`;
  assert.equal(P.stampIsTheConsultationsOwn(clockStamp), false);
  const orFallback = `
  const ${BINDING} = formatVisitDateBg(${STAMP}) || wall;
  setVisitCreatedAt(null);
  setVisitCreatedAt(decision.pendingVisit?.created_at ?? null);
  setVisitCreatedAt(recovery.pendingVisit.created_at ?? null);
  setVisitCreatedAt(consultation.created_at ?? null);`;
  assert.equal(P.stampIsTheConsultationsOwn(orFallback), false, 'the „|| wall" shape, one file up');
});

test('R2/instrument: atClock is a faithful Date — Date() without `new` works', () => {
  // The subclass version of atClock threw `TypeError: Class constructor cannot
  // be invoked without 'new'` on exactly the spelling that beat round 1, so a
  // mutation died by instrument accident rather than by assertion. An
  // instrument that has never been shown to execute the hazard is not evidence.
  const asString = atClock('2026-08-28T08:00:00.000Z', () => String(Date()));
  assert.ok(asString.includes('2026'), asString);
  assert.equal(atClock('2026-08-28T08:00:00.000Z', () => Date.now()),
    Date.parse('2026-08-28T08:00:00.000Z'));
  assert.equal(
    atClock('2026-08-28T08:00:00.000Z', () => new Date('2026-08-08T09:12:00.000Z').toISOString()),
    '2026-08-08T09:12:00.000Z',
    'an explicit argument must still parse normally',
  );
});

// ── 6. Red proof — the behavioural half ───────────────────────────────────
// Sections 1–3 call the real module, so their red proof cannot be a string
// fixture: it has to be a builder. Two of them. The first is the one that
// SHIPPED — verbatim from components/PatientSummaryModal.tsx at 19be4c8 — and
// every behavioural assertion above is re-run against it here, red. The second
// is the `|| today` fallback, which no source predicate on the modal or the
// page could ever see because it would live inside the module.

/** buildPrintHtml exactly as it shipped: the clock, and no way to be told a
 *  date — its second parameter is `patientName`. */
function shippedBuilder(summary: string, patientName?: string): string {
  const dateStr = new Date().toLocaleDateString('bg-BG', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const who = patientName ? `<div class="who">${patientName}</div>` : '';
  return `<h1>Резюме за пациента</h1>
${who}
<div class="date">${dateStr}</div>
<div class="text">${summary}</div>`;
}

test('RED: the shipped builder dates the patient sheet by the clock', () => {
  const printed_on_28 = atZone('Europe/Sofia', () =>
    atClock('2026-08-28T08:00:00.000Z', () => shippedBuilder(BODY)));
  assert.equal(dateCell(printed_on_28), '28.08.2026 г.',
    'this is the defect: a note recorded on 08.08, printed on 28.08, dated 28.08');
  // The same note, the same clock, through the module that ships now.
  const fixed = atZone('Europe/Sofia', () =>
    atClock('2026-08-28T08:00:00.000Z',
      () => buildPatientSummaryHtml(BODY, formatVisitDateBg(AUG_8))));
  assert.equal(dateCell(fixed), AUG_8_BG);
});

test('RED: the shipped builder could not be told a date — the vacuity, pinned', () => {
  // Its second parameter is patientName, so handing it the визит date renders
  // that date into the `who` line while `.date` still shows today. Three
  // assertions in sections 1 and 3 were written unscoped and went GREEN against
  // this builder for exactly that reason before `dateCell` existed.
  const html = atZone('Europe/Sofia', () =>
    atClock('2026-08-28T08:00:00.000Z', () => shippedBuilder(BODY, AUG_8_BG)));
  assert.ok(html.includes(AUG_8_BG), 'present in the document…');
  assert.notEqual(dateCell(html), AUG_8_BG, '…but not where a date belongs');
  assert.equal(dateCell(html), '28.08.2026 г.');
});

test('RED: the shipped builder always emits a date block, with nothing to show or not', () => {
  const html = atZone('Europe/Sofia', () =>
    atClock('2026-08-28T08:00:00.000Z', () => shippedBuilder(BODY)));
  assert.ok(html.includes('class="date"'),
    'it has no absent state at all — which is why „absent, never wrong" needed a new builder');
});

test('the extraction changed the date binding, and the deletion changed only `who`', () => {
  // The boundary was: no other change to the patient summary — not its content,
  // its wording, its disclaimer. Byte equality is the only form of that claim
  // worth making, so it is still made here, against the shipped builder.
  //
  // ONE difference is now expected and is named exactly. `patientName` was
  // deleted: a dead patient-identity channel into a patient-facing printed
  // sheet, rendered directly above the date cell. With no name to show the
  // shipped builder emitted an EMPTY `who` slot — a bare newline — and the new
  // module emits no slot at all. That newline is the whole delta, and it is
  // subtracted here by name rather than normalised away with a whitespace
  // trim, which would have hidden any other change alongside it.
  const shipped = atZone('Europe/Sofia', () =>
    atClock('2026-08-08T09:12:00.000Z', () => shippedBuilder(BODY)));
  const EMPTY_WHO_SLOT = '<h1>Резюме за пациента</h1>\n\n';
  assert.ok(shipped.startsWith(EMPTY_WHO_SLOT),
    'the shipped builder no longer opens with an empty who slot — re-derive the delta');
  const shippedWithoutWhoSlot = shipped.replace(EMPTY_WHO_SLOT, '<h1>Резюме за пациента</h1>\n');
  assert.equal(shipped.length - shippedWithoutWhoSlot.length, 1, 'exactly one byte, the newline');

  const now = buildPatientSummaryHtml(BODY, AUG_8_BG);
  assert.ok(now.includes(shippedWithoutWhoSlot),
    'same h1 / date / text block as shipped, byte for byte, minus the empty who slot');

  // And the slot is GONE, not merely empty: nothing renders it, and nothing can
  // be handed to it. Both halves — the markup and the arity — because either
  // one alone leaves the channel half-open.
  assert.ok(!/class="who"/.test(now), 'the who element is gone from the document');
  assert.ok(!/\.who\s*\{/.test(now), 'and so is its style rule');
  assert.equal(buildPatientSummaryHtml.length, 2,
    'the builder takes exactly (summary, dateBg) — a third parameter is a channel');
});

/** The `|| today` shape, inside the builder this time — the third site the
 *  fallback could reappear at, and the only one no source predicate on the
 *  modal or the page would ever see. */
function mutantBuilderWithWallFallback(summary: string, dateBg: string): string {
  const wall = new Date().toLocaleDateString('bg-BG', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const shown = dateBg || wall;
  return `<div class="date">${shown}</div><div class="text">${summary}</div>`;
}

test('RED: a builder with a wall-clock fallback prints today when the stamp is gone', () => {
  const html = atClock('2026-08-27T08:00:00.000Z',
    () => mutantBuilderWithWallFallback(BODY, ''));
  assert.ok(/\d{2}\.\d{2}\.\d{4}/.test(html),
    'the mutant must print a date, or the absent-date assertions prove nothing');
  assert.ok(html.includes('27.08.2026 г.'), 'and it is today — the defect, reproduced');
  // The real builder, same input, same clock: nothing.
  const real = atClock('2026-08-27T08:00:00.000Z',
    () => buildPatientSummaryHtml(BODY, ''));
  assert.ok(!/\d{2}\.\d{2}\.\d{4}/.test(real));
});

test('RED: the builder-source predicate catches that fallback in the module', () => {
  const mutantSrc = `
export function ${DOC}(summary: string, dateBg: string): string {
  const wall = new Date().toLocaleDateString('bg-BG');
  return dateBg || wall;
}
`;
  assert.equal(
    /new Date\(|Date\.now\(|toLocaleDate|toLocaleString|DateTimeFormat/.test(mutantSrc),
    true,
  );
});
