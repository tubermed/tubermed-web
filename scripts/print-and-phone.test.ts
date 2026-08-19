// What a phone shows and what paper carries (2026-08-19)
//
// Two findings from the 2026-08-15 pilot-readiness audit, both pure layout, and
// both invisible to every gate this repo had:
//
//   • The result page's right rail is the SOLE home of the structured
//     medication list, the drug-safety warnings, „+ Нова консултация" and the
//     Article-17 erase control — and it was `display: none` below 720px. A
//     doctor on a phone could not see the meds and could not exercise a
//     data-subject request.
//   • The same rail is `no-print`, and the print stylesheet hides every
//     `aside`. So Ctrl+P printed the `terapia` prose and dropped the drug table
//     silently. (The „Печат" BUTTON was never affected — it opens
//     generatePdfHtml, which has carried a Медикаменти table all along.)
//
// Neither shows up in tsc, lint, or the DOM-free unit suite: the first is a CSS
// rule, the second is the absence of an element. So this file reads the SOURCE
// and asserts the structure — the same shape as the backend's projection gate,
// for the same reason. It is a text gate, and a text gate is worth exactly as
// much as its red proof, so section 4 runs every predicate against deliberately
// broken input and fails if any of them stays green.
//
// Run: node --test scripts/print-and-phone.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const CSS        = read('app/globals.css');
const RESULT     = read('app/app/scribe/result/page.tsx');
const MEDS_PANEL = read('components/MedsPanel.tsx');
const SHELL      = read('components/AppShell.tsx');
const SIDEBAR    = read('components/ClinicSidebar.tsx');

// ── Predicates. Section 4 feeds these broken input; keep them pure. ─────────
const P = {
  /** The narrow-screen rule must not hide the LAST aside (the meds rail). */
  railSurvivesPhone(css: string): boolean {
    const block = css.slice(css.indexOf('@container (max-width: 720px)'));
    const body = block.slice(0, block.indexOf('\n}\n\n') + 2);
    // A bare `> aside { display: none }` takes both rails down with it.
    if (/>\s*aside\s*\{[^}]*display:\s*none/.test(body)) return false;
    return /aside:last-of-type\s*\{[^}]*display:\s*block/.test(body);
  },
  /** `.print-only` must be hidden on screen AND unhidden inside @media print. */
  printOnlyIsWired(css: string): boolean {
    const hiddenOnScreen = /(^|\n)\.print-only\s*\{[^}]*display:\s*none/.test(css);
    const printBlock = css.slice(css.indexOf('@media print'));
    const shownOnPaper = /\.print-only\s*\{[^}]*display:\s*block\s*!important/.test(
      printBlock.slice(0, printBlock.indexOf('\n}\n')),
    );
    return hiddenOnScreen && shownOnPaper;
  },
  /** The paper table must reuse the copy formatter, not reimplement it. */
  paperReusesCopyFormatter(page: string, panel: string): boolean {
    const exported = /export function formatMedLine/.test(panel);
    const imported = /import MedsPanel,\s*\{[^}]*\bformatMedLine\b[^}]*\}/.test(page);
    const rendered = /<PrintMedsBlock\b/.test(page);
    const usedInBlock = (() => {
      const i = page.indexOf('function PrintMedsBlock');
      if (i < 0) return false;
      return /formatMedLine/.test(page.slice(i, i + 900));
    })();
    return exported && imported && rendered && usedInBlock;
  },
  /** The 252px rail must have a phone shape, and the shell must stack for it. */
  shellStacksOnPhone(shell: string, sidebar: string): boolean {
    return /flex-col\s+md:flex-row/.test(shell)
        && /w-full\s+md:w-\[252px\]/.test(sidebar);
  },
};

test('the meds rail survives a phone — it is not a convenience panel', () => {
  assert.ok(P.railSurvivesPhone(CSS),
    'the @container (max-width: 720px) rule must keep aside:last-of-type visible');
  // The left section-nav genuinely is convenience and may still hide.
  const block = CSS.slice(CSS.indexOf('@container (max-width: 720px)'));
  assert.match(block.slice(0, 600), /aside:first-of-type\s*\{[^}]*display:\s*none/);
});

test('sticky is dropped once the rail is in the document flow', () => {
  const block = CSS.slice(CSS.indexOf('@container (max-width: 720px)'));
  assert.match(block.slice(0, 800), /aside:last-of-type\s*>\s*div\s*\{[^}]*position:\s*static/,
    'a sticky element in a single-column grid can pin itself off-screen on iOS');
});

test('the medication table reaches paper', () => {
  assert.ok(P.printOnlyIsWired(CSS), '.print-only must be display:none on screen and block in @media print');
  assert.ok(P.paperReusesCopyFormatter(RESULT, MEDS_PANEL),
    'PrintMedsBlock must render through formatMedLine — the same formatter as „Копирай медикаментите"');
});

test('the paper block is NOT inside a container the print sheet hides', () => {
  // `header, nav, aside, .no-print` are all display:none !important on paper,
  // so WHERE the block is rendered decides whether it prints at all. Counting
  // unclosed tags ahead of it is the only containment answer a text gate can
  // give honestly — a "last occurrence of no-print" heuristic reads closed
  // sibling elements as ancestors and is wrong more often than it is right.
  const i = RESULT.indexOf('<PrintMedsBlock');
  assert.ok(i > 0, 'PrintMedsBlock must be rendered');
  const before = RESULT.slice(0, i);
  const count = (s: string, re: RegExp) => (s.match(re) || []).length;
  const openAsides = count(before, /<aside\b/g) - count(before, /<\/aside>/g);
  assert.equal(openAsides, 0, 'PrintMedsBlock sits inside an <aside>, which the print stylesheet hides');
  const openMains = count(before, /<main\b/g) - count(before, /<\/main>/g);
  assert.ok(openMains >= 1, 'PrintMedsBlock must sit inside the document <main>');

  // And the block's own root must not opt itself out of print. Bound the slice
  // to the function BODY — the next top-level `}` — or the scan runs into the
  // neighbouring component, whose comment mentions no-print and would fail this
  // for the wrong reason.
  const start = RESULT.indexOf('function PrintMedsBlock');
  const body = RESULT.slice(start, RESULT.indexOf('\n}\n', start) + 2);
  assert.ok(body.length > 100 && body.length < 2000, 'failed to bound the PrintMedsBlock body');
  assert.ok(!/no-print/.test(body), 'the paper block must not carry no-print');
  assert.match(body, /className="print-only"/);
  assert.match(body, /formatMedLine/);
});

test('the 252px sidebar has a phone shape', () => {
  assert.ok(P.shellStacksOnPhone(SHELL, SIDEBAR),
    'AppShell must stack flex-col below md and ClinicSidebar must go full-width');
  // Icon-only nav at strip width still has to be NAMED for assistive tech.
  assert.match(SIDEBAR, /aria-label=\{item\.label\}/,
    'the nav label is hidden below md — aria-label must carry it');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Red proof. Each predicate is fed the shape it exists to reject; a `true`
//    here means the assertions above are decorative.
// ─────────────────────────────────────────────────────────────────────────────
test('RED PROOF — every predicate rejects the regression it guards', () => {
  // The pre-2026-08-19 CSS: one bare rule that hid both rails.
  const OLD_CSS = `
@container (max-width: 720px) {
  .result-grid { grid-template-columns: 1fr; padding: 16px; }
  .result-grid > aside { display: none; }
}

@media print {
  header, nav, aside, .no-print { display: none !important; }
}
`;
  assert.equal(P.railSurvivesPhone(OLD_CSS), false,
    'the phone predicate accepted the rule that hid the meds rail');
  assert.equal(P.printOnlyIsWired(OLD_CSS), false,
    'the print predicate accepted a stylesheet with no .print-only wiring at all');

  // Half-wired: the class exists on screen but the print sheet never unhides it.
  assert.equal(P.printOnlyIsWired(`.print-only { display: none; }\n@media print {\n  body { background: white; }\n}\n`), false,
    'the print predicate accepted a .print-only that never becomes visible on paper');

  // A second implementation of the medication line — the drift this guards.
  const FORKED = RESULT.replace(
    /import MedsPanel,\s*\{\s*formatMedLine\s*\}/,
    'import MedsPanel',
  ).replace(/formatMedLine\(m\)/g, 'String(m.inn)');
  assert.equal(P.paperReusesCopyFormatter(FORKED, MEDS_PANEL), false,
    'the formatter predicate accepted a page that stopped importing formatMedLine');

  assert.equal(P.shellStacksOnPhone('<div className="min-h-screen flex">', SIDEBAR), false,
    'the shell predicate accepted a shell that never stacks');
  assert.equal(P.shellStacksOnPhone(SHELL, 'className="h-screen sticky top-0 flex flex-col w-[252px]"'), false,
    'the sidebar predicate accepted the un-collapsible 252px rail');
});
