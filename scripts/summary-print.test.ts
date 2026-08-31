// ─────────────────────────────────────────────────────────────────────────────
// The Вариант A print layout of „Резюме за пациента" (2026-08-31).
//
// WHAT THIS GATE HOLDS
//
//  1. CONSERVATION — layout, not content. The builder re-frames the summary
//     text (sections, cards, the warning box) and may absorb exactly two
//     typographic separators into layout: a known heading's trailing „:" and
//     the „ — " between a medication lead and its regimen. Every other token
//     of the input reaches the printed sheet, in order, whatever shape the
//     text arrives in — the twenty shapes below are the catalogue.
//  2. NO RED — `#C0392B` means medication-safety alert in this product and
//     nothing else. The patient sheet must not spend it: the warning box earns
//     its weight from a 3px ink border and a solid ink header band instead.
//     Banned in the module's source AND in every built document, in hex and in
//     rgb() spelling, red-proven below.
//  3. TOKEN DISCIPLINE — the two print tokens (#C2CAD4 print-rule, #E8EFF7
//     print-med-fill) are defined ONCE and referenced as var(--…). A literal
//     repeated is a literal that will disagree with itself.
//  4. PAGE-BREAK CONTRACT — the warning box never splits across a page break
//     (and each flag row refuses to split, for the day the box outgrows a page
//     and Chrome breaks it anyway); the document tail (last content block +
//     disclaimer + footer) travels as one unbreakable group so the legal line
//     can never open a page alone. Break behaviour itself was measured on a
//     real Chrome print pipeline (A4 and Letter, 2026-08-31: minimal note 1
//     page, 2.5× note 2 pages, warning box intact on page 2, no dated header
//     at 6mm top margin, ink band printed with background graphics OFF); what
//     a DOM-free test can hold is that the CSS that produced those numbers
//     stays declared, and that is what section 4 pins.
//
// Siblings: scripts/summary-date.test.ts (the date), print-margin.test.ts
// (the page box), document-identity.test.ts (who may be named on the sheet),
// printed-document.test.ts (no invented dates).
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
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
// Comments dropped for the source-side red check: the module's own header
// EXPLAINS the red ban by naming the banned hex, and a gate a comment can trip
// pressures the next reader into deleting the explanation. Template-literal
// content (the emitted CSS) is NOT comment-shaped, so the bytes that ship are
// still fully swept — that is the output half of the check.
const DOCSRC = readFileSync(join(ROOT, 'lib/patient-summary-doc.ts'), 'utf8')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\/\*|\*)/.test(l)).join('\n');

const { buildPatientSummaryHtml, DISCLAIMER_MARKER } =
  await import('../lib/patient-summary-doc.ts');

const DATE = '30.08.2026 г.';
const IDENTITY = {
  practiceName: 'МЦ Борово',
  doctorName: 'д-р Тест Лекар',
  specialty: 'Пулмолог',
  phone: '0700 00 000',
};

const DISCLAIMER =
  'Това резюме е информационно и не замества медицинска консултация. При въпроси или влошаване потърсете Вашия лекуващ лекар.';

// ── The detectors ───────────────────────────────────────────────────────────

/** The reserved red, both spellings, any case, whitespace-tolerant in rgb(). */
const RESERVED_RED = /#c0392b|rgb\(\s*192\s*,\s*57\s*,\s*43\s*\)/i;

const unescapeHtml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** What a patient can read: tags and the stylesheet stripped, entities undone. */
const visibleText = (html: string) =>
  unescapeHtml(html.replace(/<style>[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' '));

/** Whitespace-split tokens, with the two layout-absorbed separators dropped:
 *  standalone dashes, and a token's trailing colon (the eyebrow row replaces a
 *  heading's „:"; a colon elsewhere — e.g. inside a sentence — survives inside
 *  its token and still matches, because BOTH sides are normalised the same
 *  way). */
const tokens = (s: string) =>
  s.split(/\s+/)
    .map((t) => t.replace(/:$/, ''))
    .filter((t) => t !== '' && !/^[—–-]+$/.test(t));

function isSubsequence(needle: string[], hay: string[]): boolean {
  let i = 0;
  for (const h of hay) if (i < needle.length && h === needle[i]) i++;
  return i === needle.length;
}

/** The input's tokens in the order the DOCUMENT declares it renders them: the
 *  disclaimer (the last paragraph carrying the marker) always renders last,
 *  wherever the edit flow left it; everything else keeps its order. Built
 *  independently of the parser under test, from the same exported marker. */
function expectedTokens(summary: string): string[] {
  const paragraphs = (summary || '').replace(/\r\n/g, '\n').trim().split(/\n{2,}/);
  let disclaimer = '';
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    if (DISCLAIMER_MARKER.test(paragraphs[i])) {
      disclaimer = paragraphs[i];
      paragraphs.splice(i, 1);
      break;
    }
  }
  return tokens(paragraphs.join('\n') + '\n' + disclaimer);
}

const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

/** The declarations of one CSS class rule in the emitted stylesheet. */
function cssRule(html: string, selector: string): string {
  // ascii-safe: CSS selector syntax in our own emitted stylesheet
  const m = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`).exec(html);
  return m ? m[1] : '';
}

// ── The catalogue: twenty shapes of content ─────────────────────────────────
// Synthetic throughout. Each is a summary the builder can actually be handed:
// the backend's mandated shape, the doctor's free edits, and the shapes a
// refuter reaches for (injection, absurd length, missing pieces).

const FINDINGS = 'При прегледа установихме остра болка в кръста, появила се след вдигане на тежест.';
const THERAPY = 'Ибупрофен 400 мг — по 1 таблетка три пъти дневно. Приемайте го след хранене, за да предпазите стомаха.';
const WARNING = 'Потърсете лекар, ако болката се засили значително, появи се изтръпване или слабост в краката, или имате затруднения при уриниране.';

const MINIMAL = `Какво установихме:\n${FINDINGS}\n\nВашата терапия:\n${THERAPY}\n\nНа какво да обърнете внимание:\n${WARNING}\n\n${DISCLAIMER}`;

const EIGHT_FLAGS = Array.from(
  { length: 8 },
  (_, i) => `Потърсете лекар при оплакване номер ${'десет'.slice(0, 3 + (i % 3))} — вижте указанията.`,
).join('\n');

const SHAPES: Array<{ id: string; summary: string }> = [
  { id: 'S01 the brief\'s own minimal note', summary: MINIMAL },
  {
    id: 'S02 2.5× stress: three drugs, five flags, long finding',
    summary: `Какво установихме:\nПри прегледа установихме високо кръвно налягане (артериална хипертония), както и остра болка в кръста. Установихме също леко повишени стойности на кръвната захар, които трябва да се проследяват редовно.\n\nВашата терапия:\nИбупрофен 400 мг — по 1 таблетка три пъти дневно, в продължение на 5 дни. Приемайте го след хранене.\n\nАмлодипин 5 мг — по 1 таблетка веднъж дневно, в продължение на 30 дни. Не спирайте приема сами.\n\nОмепразол 20 мг — по 1 капсула веднъж дневно, сутрин на гладно. Тя предпазва стомаха.\n\nНа какво да обърнете внимание:\nПотърсете лекар, ако болката се засили значително.\nПотърсете незабавно лекар при изтръпване или слабост в краката.\nПотърсете лекар при силно главоболие, замайване или задух.\nАко получите стомашни болки или парене, спрете обезболяващото.\nПри много високи стойности на кръвното налягане потърсете спешна помощ.\n\nСледващи стъпки:\nКонтролен преглед след един месец. Носете дневника със стойностите.\n\n${DISCLAIMER}`,
  },
  { id: 'S03 one line, no headings at all', summary: `Починете си и пийте много течности.\n\n${DISCLAIMER}` },
  { id: 'S04 body with no disclaimer anywhere', summary: MINIMAL.replace(`\n\n${DISCLAIMER}`, '') },
  { id: 'S05 disclaimer only, empty body', summary: DISCLAIMER },
  { id: 'S06 eight red flags', summary: `На какво да обърнете внимание:\n${EIGHT_FLAGS}\n\n${DISCLAIMER}` },
  { id: 'S07 a single red flag', summary: `На какво да обърнете внимание:\nПотърсете лекар при висока температура.\n\n${DISCLAIMER}` },
  {
    id: 'S08 a long unbroken medication name',
    summary: `Вашата терапия:\nМетилпреднизолонацепонатхидрокортизонбутират 250 мг — по 1 таблетка дневно. Приемайте я сутрин.\n\n${DISCLAIMER}`,
  },
  { id: 'S09 a decimal-comma dose', summary: `Вашата терапия:\nМетопролол 47,5 мг — по половин таблетка сутрин. Не я дъвчете.\n\n${DISCLAIMER}` },
  { id: 'S10 a plain hyphen where the dash goes', summary: `Вашата терапия:\nПарацетамол 500 мг - по 1 таблетка при нужда. Не повече от четири дневно.\n\n${DISCLAIMER}` },
  { id: 'S11 therapy with no dash at all', summary: `Вашата терапия:\nОграничете солта в храната и се движете повече.\n\n${DISCLAIMER}` },
  { id: 'S12 a heading with content on the same line', summary: `Какво установихме: всичко е наред при прегледа.\n\n${DISCLAIMER}` },
  { id: 'S13 a heading the doctor retyped in caps', summary: `КАКВО УСТАНОВИХМЕ:\nПрегледът мина спокойно.\n\n${DISCLAIMER}` },
  { id: 'S14 the same section twice', summary: `Вашата терапия:\nИбупрофен 400 мг — по 1 таблетка сутрин. След хранене.\n\nВашата терапия:\nВитамин Д — по 1 капка дневно. С храна.\n\n${DISCLAIMER}` },
  { id: 'S15 warning first — order is the text\'s, never re-sorted', summary: `На какво да обърнете внимание:\n${WARNING}\n\nВашата терапия:\n${THERAPY}\n\n${DISCLAIMER}` },
  { id: 'S16 free text before the first heading', summary: `Благодарим Ви за посещението.\n\nКакво установихме:\n${FINDINGS}\n\n${DISCLAIMER}` },
  {
    id: 'S17 an injection attempt is text, not markup',
    summary: `Какво установихме:\n<script>alert('x')</script> и <img src=x onerror=alert(1)> в бележката.\n\n${DISCLAIMER}`,
  },
  { id: 'S18 CRLF line endings', summary: MINIMAL.replace(/\n/g, '\r\n') },
  { id: 'S19 a content date the doctor dictated', summary: `Следващи стъпки:\nКонтролен преглед на 14.02.2027 г. с направлението.\n\n${DISCLAIMER}` },
  { id: 'S20 the empty summary', summary: '' },
];

// ── 1 + 2 + 3, across the whole catalogue ───────────────────────────────────

for (const { id, summary } of SHAPES) {
  test(`${id}: conserved, red-free, tokens defined once`, () => {
    const html = buildPatientSummaryHtml(summary, DATE, IDENTITY);

    // Conservation: every input token reaches the sheet, in order.
    const missing = expectedTokens(summary);
    assert.ok(isSubsequence(missing, tokens(visibleText(html))),
      `the printed sheet lost or reordered text of the summary (${id})`);

    // The reserved red appears nowhere — not for a warning, not for anything.
    assert.ok(!RESERVED_RED.test(html),
      'the patient sheet spends #C0392B — red is reserved for medication-safety alerts');

    // The two print tokens: one definition, referenced everywhere else.
    for (const [hex, name] of [['#C2CAD4', 'print-rule'], ['#E8EFF7', 'print-med-fill']] as const) {
      assert.equal(count(html.toUpperCase(), hex), 1,
        `${hex} must appear exactly once (the --${name} definition), not be repeated as a literal`);
      assert.ok(html.includes(`var(--${name})`), `--${name} is defined but never referenced`);
    }

    // Whatever the content, the document is a complete sheet.
    assert.ok(html.includes('<h1>Резюме за пациента</h1>'));
    assert.ok(html.includes('изготвено с TuberMed'));
  });
}

// ── Shape-specific structure ────────────────────────────────────────────────

test('the warning box renders one row per flag line — eight stay eight, one stays one', () => {
  const eight = buildPatientSummaryHtml(SHAPES[5].summary, DATE, IDENTITY);
  assert.equal(count(eight, 'class="warn-item"'), 8);
  const one = buildPatientSummaryHtml(SHAPES[6].summary, DATE, IDENTITY);
  assert.equal(count(one, 'class="warn-item"'), 1);
});

test('sections keep the text\'s own order — a warning written first renders first', () => {
  const html = buildPatientSummaryHtml(SHAPES[14].summary, DATE, IDENTITY);
  const warnAt = html.indexOf('class="warn"');
  const medAt = html.indexOf('class="med-card"');
  assert.ok(warnAt >= 0 && medAt >= 0);
  assert.ok(warnAt < medAt, 'the layout re-sorted the doctor\'s sections');
});

test('a heading the model emitted with nothing under it renders no empty frame', () => {
  const html = buildPatientSummaryHtml(`Какво установихме:\n${FINDINGS}\n\nНа какво да обърнете внимание:\n\n${DISCLAIMER}`, DATE, IDENTITY);
  assert.ok(!html.includes('class="warn"'),
    'an empty warning box is an alarm about nothing — the section must drop out whole');
});

test('markup arriving in the summary is escaped, never executed', () => {
  const html = buildPatientSummaryHtml(SHAPES[16].summary, DATE, IDENTITY);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;script&gt;'), 'the text itself still reaches the sheet, as text');
});

test('the letterhead degrades field by field, and an empty identity is no letterhead', () => {
  const none = buildPatientSummaryHtml(MINIMAL, DATE);
  assert.ok(!none.includes('class="practice"') && !none.includes('class="byline"'));
  assert.ok(none.includes('class="date"'), 'the date cell does not depend on the letterhead');
  const partial = buildPatientSummaryHtml(MINIMAL, DATE, { doctorName: 'д-р Тест Лекар' });
  assert.ok(partial.includes('д-р Тест Лекар') && !partial.includes('class="practice"'));
  assert.ok(!partial.includes('<span class="sep"> · </span></div>'),
    'a separator with nothing on its other side');
});

// ── 4. The page-break contract, pinned in the emitted CSS ───────────────────
// The numbers behind these pins were measured through Chrome's own print
// pipeline (see the file header). A DOM-free test cannot re-run Chrome; what
// it can do is refuse to let the declarations that produced those measurements
// vanish quietly.

test('the warning box, its rows, and the document tail refuse to split', () => {
  const html = buildPatientSummaryHtml(MINIMAL, DATE, IDENTITY);
  for (const cls of ['warn', 'warn-item', 'tail', 'med-card']) {
    assert.match(cssRule(html, cls), /break-inside:\s*avoid/,
      `.${cls} may split across a page break — the mock cannot show this, the CSS must`);
  }
});

test('the ink band and card fill survive „background graphics: off"', () => {
  // Chrome's print dialog ships with backgrounds unchecked; a band that
  // vanishes there takes its white heading text with it. Measured 2026-08-31:
  // with print-color-adjust the band's pixels print in BOTH modes.
  const html = buildPatientSummaryHtml(MINIMAL, DATE, IDENTITY);
  for (const cls of ['warn-head', 'warn-marker', 'med-card']) {
    assert.match(cssRule(html, cls), /print-color-adjust:\s*exact/,
      `.${cls} paints meaning with a background and does not force it to print`);
  }
});

test('the warning band is ink behind white text — the pairing, not either half', () => {
  // A mutation replay (M12, 2026-08-31) repainted the band with the light card
  // fill and NOTHING fired: the token-once check counts hex literals, not
  // var() references, so a var-for-var swap was invisible — and white heading
  // text on a near-white band is a heading that vanishes on every printer.
  // The pairing is the invariant: the band is ink BECAUSE the title is white.
  const html = buildPatientSummaryHtml(MINIMAL, DATE, IDENTITY);
  assert.match(cssRule(html, 'warn-head'), /background:\s*var\(--print-ink\)/,
    'the warning header band must be the ink token — its text is white');
  assert.match(cssRule(html, 'warn-title'), /color:\s*#FFFFFF/,
    'the warning title must be white — its floor is the ink band');
  assert.match(cssRule(html, 'warn-marker'), /background:\s*var\(--print-ink\)/,
    'the flag marker square is ink, or it fades out of grayscale');
});

test('the disclaimer and footer live inside the unbreakable tail', () => {
  const html = buildPatientSummaryHtml(MINIMAL, DATE, IDENTITY);
  const tail = html.slice(html.indexOf('<div class="tail">'));
  assert.ok(tail.includes('class="disclaimer"') && tail.includes('class="footer"'),
    'the legal line can end up alone on a page with no clinical content above it');
  // …and the tail carries the LAST content block with them, so the group is
  // anchored to content, not floating after it.
  assert.ok(tail.includes('class="warn"') || tail.includes('class="sec"'),
    'the tail holds no content block — the footer group is separable again');
});

test('the mock\'s flex spacer is gone — a short note ends where it ends', () => {
  // The mock pushed the footer to the page floor with `flex: 1`, which makes a
  // minimal note read as an unfinished page with the warning box floating in
  // white space. The document flows instead: content, then disclaimer at a
  // fixed 32px, then the footer — like a letter.
  const html = buildPatientSummaryHtml(MINIMAL, DATE, IDENTITY);
  assert.ok(!/flex:\s*1[;\s]/.test(html), 'the spacer is back');
  assert.match(cssRule(html, 'disclaimer'), /margin:\s*32px 0 0/);
});

// ── Red proof ───────────────────────────────────────────────────────────────

test('RED: the reserved-red detector fires on every spelling', () => {
  const html = buildPatientSummaryHtml(MINIMAL, DATE, IDENTITY);
  for (const inject of ['#C0392B', '#c0392b', 'rgb(192, 57, 43)', 'rgb(192,57,43)']) {
    assert.ok(RESERVED_RED.test(html.replace('</style>', `.warn{color:${inject}}</style>`)),
      `not caught: ${inject}`);
  }
  // …and the module source is held too, not only the output.
  assert.ok(!RESERVED_RED.test(DOCSRC), 'the reserved red is in lib/patient-summary-doc.ts itself');
  assert.ok(RESERVED_RED.test(DOCSRC + '// const warn = "#C0392B"'), 'the source check is alive');
});

test('RED: a repeated token literal fails the defined-once check', () => {
  const html = buildPatientSummaryHtml(MINIMAL, DATE, IDENTITY);
  const doubled = html.replace('var(--print-rule)', '#C2CAD4');
  assert.notEqual(count(doubled.toUpperCase(), '#C2CAD4'), 1,
    'the doubled literal must be countable, or the check above proves nothing');
});

test('RED: the conservation check sees a dropped paragraph, word, and reorder', () => {
  const html = buildPatientSummaryHtml(MINIMAL, DATE, IDENTITY);
  const hay = tokens(visibleText(html));
  const want = expectedTokens(MINIMAL);
  assert.ok(isSubsequence(want, hay), 'green on the honest document, or the reds mean nothing');
  // A dropped word.
  const dropped = hay.filter((t) => t !== 'стомаха.');
  assert.ok(!isSubsequence(want, dropped));
  // A whole dropped paragraph.
  assert.ok(!isSubsequence(want, tokens(visibleText(html.replace(/<p class="med-note">[\s\S]*?<\/p>/, '')))));
  // A reorder: the first two tokens („Какво установихме", the eyebrow) moved
  // to the end no longer form a subsequence of the honest document.
  const swapped = [...want.slice(2), ...want.slice(0, 2)];
  assert.ok(!isSubsequence(swapped, hay), 'reordering must not read as conserved');
});

test('RED: the subsequence instrument itself', () => {
  assert.ok(isSubsequence(['а', 'б'], ['а', 'х', 'б']));
  assert.ok(!isSubsequence(['б', 'а'], ['а', 'х', 'б']));
  assert.ok(isSubsequence([], ['а']));
  assert.ok(!isSubsequence(['а'], []));
});

test('RED: the css-rule reader reads the shipped rules, not nothing', () => {
  const html = buildPatientSummaryHtml(MINIMAL, DATE, IDENTITY);
  assert.ok(cssRule(html, 'warn').length > 0);
  assert.equal(cssRule(html, 'no-such-class'), '');
});
