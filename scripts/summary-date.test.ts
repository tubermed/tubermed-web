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

const MODAL  = read('components/PatientSummaryModal.tsx');
const RESULT = read('app/app/scribe/result/page.tsx');
const DOCSRC = read('lib/patient-summary-doc.ts');

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

test('an unknown timestamp prints no date at all', () => {
  const html = buildPatientSummaryHtml(BODY, '');
  assert.ok(!html.includes('class="date"'),
    'the whole date block drops out — an empty grey line is a document that lost its date');
  assert.ok(!/\d{2}\.\d{2}\.\d{4}/.test(html),
    'no date-shaped text may survive anywhere in the document');
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
    assert.ok(!/\d{2}\.\d{2}\.\d{4}/.test(html),
      `expected no date for ${JSON.stringify(missing)} — a summary may be missing its date, never carry a false one`);
  }
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
/** The result page's ONE date value — already gated by scripts/list-date.test.ts
 *  as exactly `formatVisitDateBg(visitCreatedAt)`, whole statement. */
const BINDING = 'listDateBg';
/** Every way a file could make itself a date. The modal owns none of them. */
const DATE_MACHINERY =
  /new Date\(|Date\.now\(|toLocaleDate|toLocaleTimeString|toLocaleString|DateTimeFormat|formatVisitDateBg|formatDateTimeBg|formatDateBg|sofiaDayIso|todaySofiaIso/;

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

  /** The ONE call site takes the prop as its date — the WHOLE argument, so
   *  `${PROP} || wall` („if we do not know, print today", on a document that
   *  leaves the building) is red. The count check keeps it from passing
   *  vacuously once the call is deleted or renamed. */
  printTakesVisitDate(src: string): boolean {
    const sites = callArgs(code(src), DOC);
    if (sites.length !== 1) return false;
    return sites[0][1] === PROP;
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
   *  лист header and all five export paths read. Scoped to that element's own
   *  opening tag, and exclusive: no date machinery may ride along beside it. */
  pageBindsTheListDate(src: string): boolean {
    const tag = openTag(code(src), 'PatientSummaryModal');
    if (!tag) return false;
    if (!tag.includes(`${PROP}={${BINDING}}`)) return false;
    return !DATE_MACHINERY.test(tag);
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

test('the result page hands the summary the same binding the лист uses', () => {
  assert.ok(P.pageBindsTheListDate(RESULT));
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
    const opened = openPdfPreview(${DOC}(finalText, ${PROP}, patientName), { autoPrint: true });
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
  const mutated = `openPdfPreview(${DOC}(finalText, ${PROP} || wall, patientName), { autoPrint: true });`;
  assert.equal(P.printTakesVisitDate(mutated), false);
});

test('RED: „?? today" on the builder argument fails as well', () => {
  const mutated = `openPdfPreview(${DOC}(finalText, ${PROP} ?? todayBg, patientName), {});`;
  assert.equal(P.printTakesVisitDate(mutated), false);
});

test('RED: deleting the call site does not make the predicate vacuously true', () => {
  assert.equal(P.printTakesVisitDate(`function handlePrint() {}`), false);
});

test('RED: a SECOND print call site fails — one document, one date', () => {
  const two =
    `openPdfPreview(${DOC}(finalText, ${PROP}, patientName), {});\n` +
    `openPdfPreview(${DOC}(finalText, ${PROP}, patientName), {});`;
  assert.equal(P.printTakesVisitDate(two), false);
});

test('RED: callArgs reads calls, not the import list', () => {
  const importOnly = `import {\n  ${DOC},\n} from '@/lib/patient-summary-doc';`;
  assert.deepEqual(callArgs(importOnly, DOC), []);
  assert.deepEqual(
    callArgs(`${DOC}(finalText, ${PROP}, patientName)`, DOC),
    [['finalText', PROP, 'patientName']],
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
  // …and the same tag WITH the prop is green, so the scan is not just strict.
  const correct = `
      <PatientSummaryModal isOpen={summaryOpen} ${PROP}={${BINDING}}></PatientSummaryModal>
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

test('the extraction changed the date binding and NOTHING else', () => {
  // The boundary on this batch was: no other change to the patient summary —
  // not its content, its wording, its disclaimer. Byte equality is the only
  // form of that claim worth making. Handed the day it was printed on, the new
  // module emits the shipped document exactly.
  const shipped = atZone('Europe/Sofia', () =>
    atClock('2026-08-08T09:12:00.000Z', () => shippedBuilder(BODY)));
  const now = buildPatientSummaryHtml(BODY, AUG_8_BG);
  assert.ok(now.includes(shipped), 'same h1 / who / date / text block, byte for byte');
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
