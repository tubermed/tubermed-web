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
//   · `@page { size: … }` FORFEITS margin control. When the CSS page size does
//     not match the destination paper, Chrome discards the CSS margins and uses
//     the printer's own — and draws its header inside them. Verified on the
//     резюме at `size:A5; margin-top:6mm` (header drawn), at
//     `size:A5; margin:6mm` (header drawn), and with `size` removed (header
//     gone). No margin value wins while `size` stands.
//
// WHAT THIS GATE HOLDS
//
// That the top edge of every browser-printed document stays under the measured
// threshold, and that the лист's first page gives back exactly what the page
// box gave up — so „suppress the stamp" can never quietly become „restyle the
// document". The резюме is pinned as NOT protected, with the trade written
// down, because dropping `size: A5` is Dimitar's call and not this batch's.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

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

const { generatePdfHtml, generateEchoHtml } = await import('../lib/exporters.ts');
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

/** The declared `@page` blocks of a document, innermost text only. Finds them
 *  wherever they sit, including nested inside `@media print { … }` — the лист's
 *  is nested, and a gate that only looked at top level would read it as absent
 *  and pass the document as unprotected-but-unnoticed. */
function pageBlocks(html: string): string[] {
  const out: string[] = [];
  // ascii-safe: CSS at-rule syntax
  const re = /@page\b([^{]*)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[2]);
  return out;
}

export interface PageBox { topMm: number | null; declaresSize: boolean; blocks: number }

/** The effective top margin of the page box, in mm — shorthand and longhand
 *  resolved in source order, exactly as the cascade would. `null` means the
 *  document does not pin its own top margin, so the BROWSER's default applies;
 *  that default is above the threshold (measured: the echo report carried the
 *  header with no @page at all), so null must never read as protected. */
function pageBox(html: string): PageBox {
  const blocks = pageBlocks(html);
  let topMm: number | null = null;
  let declaresSize = false;
  for (const body of blocks) {
    for (const decl of body.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim().toLowerCase();
      const value = decl.slice(i + 1).trim();
      if (prop === 'size') { declaresSize = true; continue; }
      if (prop === 'margin-top') { topMm = lengthMm(value); continue; }
      if (prop === 'margin') {
        // 1 value → all; 2 → v h; 3 → t h b; 4 → t r b l. Top is always first.
        topMm = lengthMm(value.split(/\s+/)[0]);
      }
    }
  }
  return { topMm, declaresSize, blocks: blocks.length };
}

const protectedFromHeader = (b: PageBox) =>
  b.topMm !== null && b.topMm < HEADER_THRESHOLD_MM && !b.declaresSize;

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

test('the резюме за пациента is NOT protected, and is pinned as such', () => {
  // Not an oversight and not a passing test dressed as one. `size: A5` forfeits
  // CSS margin control whenever the destination paper is not A5 — measured
  // three ways on a real print preview — so this sheet still carries
  // „8/28/26, 9:12 AM" in its margin, next to the преглед's date, in the
  // patient's hand. Removing `size: A5` removes the stamp AND the A5 page, and
  // that trade is Dimitar's.
  //
  // Pinned in BOTH directions: if `size` is dropped, this test goes red and
  // whoever dropped it must bring the top margin under the threshold and
  // rewrite this pin — the exception cannot outlive its reason.
  const box = pageBox(SUMMARY());
  assert.equal(box.declaresSize, true,
    'the резюме no longer declares @page size — the blocker is gone, so bring its top margin ' +
    `under ${HEADER_THRESHOLD_MM}mm and replace this pin with the same assertion the лист uses`);
  assert.equal(protectedFromHeader(box), false,
    'this pin claims the резюме is unprotected; it now reads as protected, so re-measure on a ' +
    'real print preview before changing the claim');
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

test('RED: the threshold constant is the measured one, not a rounded guess', () => {
  // Pinned so that „it still works" cannot drift into „nobody re-measured".
  // Sweep result: header ABSENT at 0–8mm, DRAWN at 9–20mm.
  assert.equal(HEADER_THRESHOLD_MM, 9);
  assert.ok(pageBox('<style>@page{margin-top:8mm}</style>').topMm! < HEADER_THRESHOLD_MM);
  assert.ok(!(pageBox('<style>@page{margin-top:9mm}</style>').topMm! < HEADER_THRESHOLD_MM));
});
