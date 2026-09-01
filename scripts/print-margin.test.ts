// ─────────────────────────────────────────────────────────────────────────────
// The date the browser prints, which is in none of our markup.
//
// WHAT WAS MEASURED
//
// Chrome draws its own header and footer INTO the page margin: the header
// carries the wall clock at top-left and the document title at top-right, the
// footer carries the URL and the page number. None of it is in our HTML, and
// none of the substring gates could ever have seen it. A лист printed on 28.08
// from a преглед of 08.08 read „Дата: 08.08.2026 г." in the body and
// „8/28/26, 9:05 AM" in the margin, two inches apart, and the margin is where
// the eye lands. Confirmed on a real Chrome print preview, not by reasoning.
//
// Measured on the real документи, through Chrome's own print pipeline:
//
//   · Chrome draws the header only when the page box leaves room for it. Swept
//     the лист's @page margin from 0mm to 20mm: ABSENT at 0–8mm, DRAWN at
//     9–20mm. The threshold is between 8mm and 9mm.
//   · The two edges are decided INDEPENDENTLY. `margin:8mm 15mm 15mm 15mm`
//     removes the header and keeps the footer; `margin:15mm 15mm 8mm 15mm`
//     does the reverse. Only the TOP edge carries a date, so only the top edge
//     has to move.
//   · `@page { size: … }` costs margin control on the WRONG PAPER. Where the
//     CSS page size does not match the destination, Chrome ignores the CSS
//     margin and uses the printer's own. Full matrix on the резюме, three
//     destinations each:
//
//        size:A5; margin:14mm              (shipped)   A5 —  A4 ✗  Letter ✗
//        size:A5; margin:6mm                           A5 ✓  A4 ✗  Letter ✗
//        margin:14mm            (size dropped)         A5 ✗  A4 ✗  Letter ✗
//        size:A5; margin:14mm; margin-top:6mm          A5 ✓  A4 ✗  Letter ✗
//        margin:14mm; margin-top:6mm                   A5 ✓  A4 ✓  Letter ✓
//                                              (✓ = no header, ✗ = header drawn)
//
//     So BOTH changes are needed on the резюме, and neither alone is enough:
//     dropping `size: A5` on its own leaves 14mm, which is over the threshold
//     and still draws the stamp. The first version of this note said `size` was
//     the operative cause; the matrix says the top margin is, and `size` is what
//     stops the margin from being honoured off-A5.
//
// WHAT THIS GATE HOLDS
//
// That the top edge of EVERY print surface in the repo stays under the measured
// threshold, and that the лист's first page gives back exactly what the page
// box gave up — so „suppress the stamp" can never quietly become „restyle the
// document". The резюме carries `size: A4` by RULING (2026-09-01, Dimitar:
// clinic printers are A4) and is therefore a written exception to the
// size-free rule — see PAGE_RULE_EXCEPTIONS and the резюме test below, where
// the Letter trade is recorded.
//
// It sweeps rather than enumerates, because enumerating already failed once:
// the first version held the three documents the „Печат" button builds and
// missed Ctrl+P on the result page, whose page box sits in app/globals.css —
// a file no builder imports, printing the визит date in the body and today's
// in the margin.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = Module as unknown as {
  registerHooks: (hooks: {
    resolve: (specifier: string, context: unknown, nextResolve: NextResolve) => unknown;
  }) => void;
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (err) {
      if (specifier.startsWith('.') && !specifier.endsWith('.ts')) {
        return nextResolve(specifier + '.ts', context);
      }
      throw err;
    }
  },
});

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const { generatePdfHtml, generateEchoHtml, generateWordHtml } = await import('../lib/exporters.ts');
const { buildPatientSummaryHtml } = await import('../lib/patient-summary-doc.ts');

/** Measured on Chrome 1xx/A4 by sweeping the лист's @page margin 0→20mm:
 *  header ABSENT at ≤8mm, DRAWN at ≥9mm. A document at or above this leaves
 *  room for the browser's own header, and the browser's own header is dated
 *  today. The 3mm of headroom below it is deliberate — a future Chrome may move
 *  the constant, and 8mm would be sitting on the line. */
const HEADER_THRESHOLD_MM = 9;

// ── mm arithmetic ───────────────────────────────────────────────────────────

const TO_MM: Record<string, number> = {
  mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, q: 0.25,
};

/** A CSS length in mm, or null when it is not a length this gate can compare
 *  (`auto`, a var(), a calc()). Null is NOT „fine" — see pageBoxTopMm. */
function lengthMm(tok: string): number | null {
  // ascii-safe: a CSS numeric token, never Bulgarian text
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(mm|cm|in|pt|pc|px|q)?$/i.exec(tok.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!m[2]) return n === 0 ? 0 : null;   // unitless is only legal at zero
  return n * TO_MM[m[2].toLowerCase()];
}

/** The declared `@page` blocks, innermost text only, with their SELECTOR. Finds
 *  them wherever they sit, including nested inside `@media print { … }` — the
 *  лист's is nested, and a gate that only looked at top level would read it as
 *  absent.
 *
 *  The selector is kept, not discarded: `@page :first { … }` applies to the
 *  first page ONLY, so reading it as the general rule would report a page box
 *  that most pages never get. A selector other than the bare one is refused
 *  outright below rather than guessed at. */
function pageBlocks(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  // Comments first, and this is not tidiness. The word „@page" appears in the
  // prose EXPLAINING these rules, in both the stylesheet and lib/exporters.ts,
  // and the scan below would then read the next unrelated `{ … }` as the page
  // box with a garbage selector — which is exactly what it did the first time
  // this walk ran. A gate a comment can trip is a gate that pressures the next
  // reader into deleting the explanation.
  const src = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // ascii-safe: CSS at-rule syntax
  const re = /@page\b([^{]*)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

export interface PageBox {
  topMm: number | null;
  declaresSize: boolean;
  /** The declared size's value, verbatim (e.g. 'A4'), or null when none. */
  sizeValue: string | null;
  blocks: number;
  /** A selector we cannot reason about (`:first`, `:left`, …). Such a rule
   *  governs SOME pages, so the general page box is still whatever the
   *  unqualified rule says — and if there is no unqualified rule, the browser's
   *  default. Never treated as protection. */
  qualified: boolean;
}

/** The effective top margin of the page box, in mm — shorthand and longhand
 *  resolved in source order, exactly as the cascade would. `null` means the
 *  document does not pin its own top margin, so the BROWSER's default applies;
 *  that default is above the threshold (measured: the echo report carried the
 *  header with no @page at all), so null must never read as protected. */
function pageBox(html: string): PageBox {
  const blocks = pageBlocks(html);
  let topMm: number | null = null;
  let declaresSize = false;
  let sizeValue: string | null = null;
  let qualified = false;
  for (const { selector, body } of blocks) {
    if (selector !== '') { qualified = true; continue; }  // :first / :left / :right
    for (const decl of body.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim().toLowerCase();
      const value = decl.slice(i + 1).trim();
      if (prop === 'size') { declaresSize = true; sizeValue = value; continue; }
      if (prop === 'margin-top') { topMm = lengthMm(value); continue; }
      if (prop === 'margin') {
        // 1 value → all; 2 → v h; 3 → t h b; 4 → t r b l. Top is always first.
        topMm = lengthMm(value.split(/\s+/)[0]);
      }
    }
  }
  return { topMm, declaresSize, sizeValue, blocks: blocks.length, qualified };
}

const protectedFromHeader = (b: PageBox) =>
  b.topMm !== null && b.topMm < HEADER_THRESHOLD_MM && !b.declaresSize && !b.qualified;

// ── The documents ───────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
const FIELDS = { osnovna_diagnoza: 'Остър фарингит', osnovna_mkb: 'J02.9', anamneza: 'Текст.' };
const LIST = () => generatePdfHtml(FIELDS as any, '08.08.2026 г.');
const ECHO = () => generateEchoHtml({ ...FIELDS, zaklyuchenie: 'Текст.' } as any, '08.08.2026 г.');
const SUMMARY = () => buildPatientSummaryHtml('Текст.', '08.08.2026 г.');
/* eslint-enable @typescript-eslint/no-explicit-any */

test('the амбулаторен лист does not leave room for the browser\'s dated header', () => {
  const box = pageBox(LIST());
  assert.ok(box.blocks > 0, 'the лист declares no @page at all — the browser then picks the margin');
  assert.equal(box.declaresSize, false,
    'the лист must not declare @page size: a size mismatch makes Chrome discard the CSS margins ' +
    'and print its own header inside the printer\'s (measured on the резюме)');
  assert.ok(box.topMm !== null, 'the лист must pin its own top margin, not inherit the browser\'s');
  assert.ok(box.topMm! < HEADER_THRESHOLD_MM,
    `the лист's page-box top margin is ${box.topMm}mm; at ${HEADER_THRESHOLD_MM}mm and above ` +
    'Chrome draws its own header there, dated today');
  assert.ok(protectedFromHeader(box));
});

test('the ехокардиография does not leave room for the browser\'s dated header', () => {
  const box = pageBox(ECHO());
  assert.ok(box.blocks > 0, 'the echo report declares no @page — measured, it then carries the header');
  assert.ok(box.topMm !== null && box.topMm < HEADER_THRESHOLD_MM,
    `the echo report's page-box top margin is ${box.topMm}mm`);
  assert.ok(protectedFromHeader(box));
});

// ── Every print surface in the repo, found rather than listed ───────────────
// The first version of this gate held the three documents the „Печат" button
// builds. It missed a fourth printed surface entirely — Ctrl+P on the result
// page, whose page box lives in app/globals.css, a file no builder imports and
// no gate read. It printed the визит date in the body and today's in the margin
// for a whole round. So the gate no longer takes a list: it walks the repo,
// finds every `@page` there is, and holds all of them.

/** Every tracked source file that could declare a page box. */
function filesWithPageRule(): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', '.next', '.git', '.claude', 'out', 'dist']);
  const walk = (rel: string) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(child); continue; }
      if (!/\.(css|scss|ts|tsx|js|jsx|html)$/.test(e.name)) continue;
      if (/\.test\.tsx?$/.test(e.name)) continue;   // fixtures, not surfaces
      if (read(child).includes('@page')) out.push(child);
    }
  };
  walk('');
  return out.sort();
}

const PAGE_RULE_FILES = filesWithPageRule();

/** Files whose `@page` is NOT held to the threshold, each with its reason.
 *  An exception has to be written down here to exist. */
const PAGE_RULE_EXCEPTIONS: Record<string, string> = {
  // Downloaded as a .doc and opened in Word. Word draws no browser header, and
  // its own headers are off by default; this document never passes through
  // Chrome's print path. It has no @page at all, which is why it is named here
  // rather than silently absent — see the Word test below.
  'lib/exporters.ts:generateWordHtml': 'opened in Word, never printed by the browser',
  // The резюме declares `size: A4` by RULING (2026-09-01, Dimitar: clinic
  // printers are A4), which `protectedFromHeader` refuses on principle — a
  // size declaration forfeits the CSS margins on any paper it doesn't match
  // (the measured matrix at the top of this file). The trade is accepted and
  // held by its own dedicated test below, which pins size to exactly A4 and
  // the top margin to 6mm; this entry only excuses it from the size-free
  // sweep, never from the margin check that test performs.
  'lib/patient-summary-doc.ts': 'size: A4 by ruling 2026-09-01 — held by its own test below',
};

test('every @page in the repo is under the browser\'s header threshold', () => {
  assert.ok(PAGE_RULE_FILES.length >= 3,
    `the walk found only ${PAGE_RULE_FILES.length} file(s) with an @page rule: ${PAGE_RULE_FILES}`);
  const unprotected: string[] = [];
  for (const f of PAGE_RULE_FILES) {
    if (f in PAGE_RULE_EXCEPTIONS) continue;
    const box = pageBox(read(f));
    if (!protectedFromHeader(box)) {
      unprotected.push(`${f} (top ${box.topMm}mm, size:${box.declaresSize}, qualified:${box.qualified})`);
    }
  }
  assert.deepEqual(unprotected, [],
    'these print surfaces leave room for the browser\'s own header, which is dated today:\n' +
    unprotected.join('\n') +
    `\nBring the page box\'s TOP margin under ${HEADER_THRESHOLD_MM}mm, or add a written exception.`);
});

test('the result page\'s own Ctrl+P surface is one of them', () => {
  // Named explicitly as well as swept, because this is the one that was missed:
  // it is a documented print path (see the block comment in app/globals.css and
  // PrintMedsBlock in the result page), and it prints the визит date.
  assert.ok(PAGE_RULE_FILES.includes('app/globals.css'),
    'the walk no longer reaches app/globals.css — the surface that was missed');
  const box = pageBox(read('app/globals.css'));
  assert.ok(box.topMm !== null && box.topMm < HEADER_THRESHOLD_MM,
    `Ctrl+P on the result page has a ${box.topMm}mm top margin`);
});

test('the Word document is exempt for a written reason, not by omission', () => {
  // It genuinely has no page box. That is fine — and it is recorded, so nobody
  // has to rediscover why the fourth builder is not in the sweep.
  const html = generateWordHtml(
    { osnovna_diagnoza: 'Остър фарингит' } as never, '08.08.2026 г.', {},
  );
  assert.equal(pageBlocks(html).length, 0, 'the Word document has grown a page box — hold it too');
  assert.ok('lib/exporters.ts:generateWordHtml' in PAGE_RULE_EXCEPTIONS);
});

test('the резюме prints A4 by ruling, top margin still under the header threshold', () => {
  // History of this pin, both directions. The Вариант A rebuild (2026-08-31)
  // shipped SIZE-LESS `margin: 6mm 15mm 11mm` — the matrix's only row clean on
  // A5, A4 AND Letter — as a flagged deviation from the brief's `size: A4`.
  // Dimitar then RULED (2026-09-01): clinic printers are A4, `size: A4` ships.
  //
  // The Letter trade, recorded either way per the ruling: on A4 paper the two
  // forms are identical (A4 is Chrome's default page box here — margins hold,
  // no stamp, measured 2026-08-31). On LETTER paper the declared A4 does not
  // match the destination, which is the mismatch class the matrix measured on
  // every `size: A5` row: Chrome discards the CSS margins, uses the printer's
  // own, and a top margin ≥9mm draws the dated header. Letter under `size: A4`
  // specifically was NOT re-run through the print pipeline in this batch — the
  // verdict is carried over from the measured mismatch mechanism, and a clinic
  // that somehow feeds Letter gets the stamp back. Accepted by the ruling.
  const box = pageBox(SUMMARY());
  assert.ok(box.blocks > 0, 'the резюме declares no @page at all — the browser then picks the margin');
  assert.equal(box.sizeValue, 'A4',
    'the резюме declares size A4 by ruling (2026-09-01) — no other size, and not size-less');
  assert.equal(box.topMm, 6,
    `the резюме's page-box top margin is ${box.topMm}mm; the design fixes it at 6mm — ` +
    `9mm is where Chrome starts stamping, and this document already lost that fight once`);
  assert.equal(box.qualified, false);
  // NOT protectedFromHeader — the size declaration disqualifies it by design.
  // That is exactly the written exception above; this test is the replacement
  // guarantee: right size, right top margin, on A4 paper no room for the stamp.
  assert.ok('lib/patient-summary-doc.ts' in PAGE_RULE_EXCEPTIONS,
    'the резюме left the sweep without its written exception');
});

test('the лист gives back on the first page exactly what the page box gave up', () => {
  // „Suppress the stamp" must not become „restyle the document". The лист used
  // to sit at @page 15mm + 16px of print padding; it now sits at 6mm + (16px +
  // 9mm), which is the same number. Held arithmetically so that changing one
  // half without the other is red rather than invisible.
  const html = LIST();
  const box = pageBox(html);
  // ascii-safe: a CSS declaration in our own generated stylesheet
  const pad = /@media print\{[\s\S]*?body\{[^}]*padding:calc\(16px \+ (\d+(?:\.\d+)?)mm\)/.exec(html);
  assert.ok(pad, 'the лист\'s print padding is no longer the compensated form this gate can read');
  const ORIGINAL_TOP_MM = 15;   // what @page carried before the стамп was removed
  assert.equal(box.topMm! + parseFloat(pad![1]), ORIGINAL_TOP_MM,
    `page box ${box.topMm}mm + first-page padding ${pad![1]}mm must total the лист's original ` +
    `${ORIGINAL_TOP_MM}mm, or the first page has been restyled`);
});

// ── Red proof ───────────────────────────────────────────────────────────────

test('RED: the parser reads every shape a page box is written in', () => {
  const cases: Array<[string, number | null]> = [
    ['@page{margin:15mm}', 15],
    ['@page{margin:6mm}', 6],
    ['@page{margin:8mm 15mm 15mm 15mm}', 8],          // top is the first of four
    ['@page{margin:15mm 20mm}', 15],                   // vertical first of two
    ['@page{margin:8mm 15mm 20mm}', 8],                // top of three
    ['@page{margin:15mm;margin-top:6mm}', 6],          // longhand wins, source order
    ['@page{margin-top:6mm;margin:15mm}', 15],         // …and loses when it comes first
    ['@page{margin-top:0.4in}', 25.4 * 0.4],
    ['@page{margin-top:24pt}', 24 * 25.4 / 72],
    ['@page{margin-top:0}', 0],                        // unitless zero is legal
    ['@page{margin-top:15}', null],                    // unitless non-zero is not
    ['@page{margin-top:auto}', null],
    ['@page{size:A5}', null],                          // no margin declared at all
  ];
  for (const [css, want] of cases) {
    const got = pageBox(`<style>${css}</style>`).topMm;
    if (want === null) assert.equal(got, null, `${css} → ${got}, expected null`);
    else assert.ok(Math.abs(got! - want) < 1e-9, `${css} → ${got}, expected ${want}`);
  }
  // The size VALUE is read verbatim, and its absence is null — the резюме test
  // pins `A4` exactly, so a reader that returned garbage would pin garbage.
  assert.equal(pageBox('<style>@page{size:A4;margin:6mm 15mm 11mm}</style>').sizeValue, 'A4');
  assert.equal(pageBox('<style>@page{size:A5}</style>').sizeValue, 'A5');
  assert.equal(pageBox('<style>@page{margin:6mm}</style>').sizeValue, null);
});

test('RED: the verdict goes red on every way the stamp comes back', () => {
  const back = [
    '@page{margin:15mm}',                    // the лист as it shipped before this batch
    '@page{margin:9mm}',                     // exactly at the measured threshold
    '@page{margin:10mm;margin-top:12mm}',
    '@page{size:A5;margin:6mm}',             // under the threshold, but size forfeits it
    '@page{size:A4;margin-top:0}',           // …at any margin, including zero
    '@page{margin-top:auto}',
    '',                                      // no page box: the browser picks, and it draws
  ];
  for (const css of back) {
    assert.equal(protectedFromHeader(pageBox(`<style>${css}</style>`)), false,
      `this leaves room for the browser's dated header and was read as safe: ${css || '(no @page)'}`);
  }
  // …and green on the shipped form, or the six above prove nothing.
  assert.equal(protectedFromHeader(pageBox('<style>@page{margin:15mm;margin-top:6mm}</style>')), true);
});

test('RED: an @page nested inside @media print is still found', () => {
  // The лист's is nested. A parser that only looked at top level would report
  // „no page box", and „no page box" is exactly the state this gate calls
  // unprotected — so the failure would have been a red herring pointing at the
  // wrong line, not a silent pass. Held anyway: the лист must be READ, not
  // guessed at.
  const nested = '<style>@media print{ body{padding:0} @page{margin:15mm;margin-top:6mm} }</style>';
  assert.equal(pageBox(nested).topMm, 6);
  assert.equal(pageBlocks(nested).length, 1);
  // And the real document is the nested shape, not a top-level one.
  assert.ok(/@media print\{[\s\S]*@page\{/.test(LIST()));
});

test('RED: a page-selector rule is never mistaken for the general page box', () => {
  // `@page :first { margin: 6mm }` protects page ONE. Reading it as the general
  // rule would report every continuation page as safe while the browser stamps
  // each of them.
  const first = '<style>@page :first{margin:6mm}</style>';
  assert.equal(pageBox(first).qualified, true);
  assert.equal(protectedFromHeader(pageBox(first)), false);
  // A qualified rule alongside a good general one is still not protection: the
  // parser refuses to reason about the combination rather than guessing.
  assert.equal(protectedFromHeader(pageBox('<style>@page{margin-top:6mm}@page :left{margin:20mm}</style>')), false);
  // …and the bare selector is not treated as qualified.
  assert.equal(pageBox('<style>@page  {margin-top:6mm}</style>').qualified, false);
});

test('RED: a comment mentioning @page does not become a page box', () => {
  // This is not hypothetical — the prose in app/globals.css and lib/exporters.ts
  // explaining these very rules says „@page", and the first version of the walk
  // read the next `{ … }` after each mention as the rule, with a garbage
  // selector. It reported app/globals.css as unprotected while the file was
  // correct: a gate a comment can trip.
  const commented = `
    /* Do not add size: to this @page — see the note above. */
    body { padding-top: 12mm }
    @media print { @page { margin: 15mm; margin-top: 6mm } }`;
  assert.equal(pageBlocks(commented).length, 1, 'exactly one real page box');
  assert.equal(pageBox(commented).topMm, 6);
  assert.equal(protectedFromHeader(pageBox(commented)), true);
});

test('RED: the repo walk finds surfaces, and would notice if it stopped', () => {
  // The walk is the whole point — a hand-list is what missed Ctrl+P. If it ever
  // silently matches nothing, every sweep above passes on an empty set.
  assert.ok(PAGE_RULE_FILES.includes('app/globals.css'));
  assert.ok(PAGE_RULE_FILES.includes('lib/exporters.ts'));
  assert.ok(PAGE_RULE_FILES.includes('lib/patient-summary-doc.ts'));
  // And it reaches OUTSIDE lib/ — the miss was a stylesheet, not a builder.
  assert.ok(PAGE_RULE_FILES.some((f) => !f.startsWith('lib/')),
    'the walk only reaches lib/, which is exactly the blind spot it exists to remove');
  // Every exception names a file the walk actually found, or the exception is
  // stale and is hiding nothing while looking like it hides something.
  for (const key of Object.keys(PAGE_RULE_EXCEPTIONS)) {
    const file = key.split(':')[0];
    assert.ok(PAGE_RULE_FILES.includes(file) || file === 'lib/exporters.ts',
      `stale exception: ${key} names a file with no @page rule`);
  }
});

test('RED: the threshold constant is the measured one, not a rounded guess', () => {
  // Pinned so that „it still works" cannot drift into „nobody re-measured".
  // Sweep result: header ABSENT at 0–8mm, DRAWN at 9–20mm.
  assert.equal(HEADER_THRESHOLD_MM, 9);
  assert.ok(pageBox('<style>@page{margin-top:8mm}</style>').topMm! < HEADER_THRESHOLD_MM);
  assert.ok(!(pageBox('<style>@page{margin-top:9mm}</style>').topMm! < HEADER_THRESHOLD_MM));
});
