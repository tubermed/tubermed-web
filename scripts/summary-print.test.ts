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

/** The reserved red by its two named spellings (hex; rgb in comma AND space
 *  syntax — a refuter walked `rgb(192 57 43)` past the comma-only version).
 *  This denylist is the SECOND line: the first is the colour WHITELIST below,
 *  which refuses every colour literal that is not a known token definition —
 *  a spelling nobody enumerated (hsl, oklch, a near-miss hex) fails there. */
const RESERVED_RED = /#c0392b|rgb\(\s*192[\s,]+57[\s,]+43\s*\)/i;

/** The document's stylesheet — the surface the colour and break rules govern.
 *  Scoped so that a NOTE whose text mentions „#C0392B" (or a token hex) stays
 *  printable: content is data, only the styling spends colours. */
const styleSheet = (html: string): string =>
  /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';

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

/** The independent expectation model — the document contract re-derived from
 *  scratch, NOT imported from the parser under test. It encodes exactly the
 *  three published rules (module header of lib/patient-summary-doc.ts):
 *  the disclaimer is the marker LINE of the final paragraph, rendered last;
 *  a matched heading loses its trailing colon; an empty-bodied heading is
 *  dropped whole. A builder change that shifts any of these diverges from
 *  this model and goes red — that is the point of writing it twice.
 *
 *  It also returns SEPARATOR ARITHMETIC. A refuter mutation deleted every
 *  spaced dash and every colon from the whole document and the token check
 *  stayed green, because the token normalisation that excuses the two
 *  sanctioned absorptions excused all of them. Tokens can't see separators;
 *  counting can: colons in the output must equal the model's exactly, and
 *  spaced dashes may drop by AT MOST one per therapy paragraph (the card
 *  split absorbs at most one each). */
interface ExpectedDoc { tokens: string[]; colons: number; spacedDashes: number; therapyPars: number }

const HEADING_LABELS = ['Какво установихме', 'Вашата терапия', 'На какво да обърнете внимание', 'Следващи стъпки'];

function expectedDoc(summary: string): ExpectedDoc {
  const text = (summary || '').replace(/\r\n/g, '\n').trim();
  const paragraphs = text === '' ? [] : text.split(/\n{2,}/);
  let disclaimer = '';
  if (paragraphs.length > 0) {
    const lastLines = paragraphs[paragraphs.length - 1].split('\n');
    for (let i = lastLines.length - 1; i >= 0; i--) {
      if (DISCLAIMER_MARKER.test(lastLines[i])) { disclaimer = lastLines[i].trim(); lastLines.splice(i, 1); break; }
    }
    if (disclaimer) {
      const rest = lastLines.join('\n').trim();
      if (rest) paragraphs[paragraphs.length - 1] = rest;
      else paragraphs.pop();
    }
  }
  type Sec = { key: string | null; label: string | null; text: string };
  const secs: Sec[] = [];
  let cur: Sec = { key: null, label: null, text: '' };
  const flush = () => {
    const t = cur.text.replace(/^\n+|\n+$/g, '');
    if (t || cur.label) secs.push({ ...cur, text: t });
  };
  for (const line of paragraphs.join('\n\n').split('\n')) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();
    let hit: { key: string; typed: string; inline: string } | null = null;
    for (const label of HEADING_LABELS) {
      const l = label.toLowerCase();
      if (lower === l || lower === `${l}:`) { hit = { key: label, typed: trimmed.replace(/:$/, ''), inline: '' }; break; }
      if (lower.startsWith(`${l}:`)) {
        hit = { key: label, typed: trimmed.slice(0, label.length), inline: trimmed.slice(label.length + 1).trim() };
        break;
      }
    }
    if (hit) { flush(); cur = { key: hit.key, label: hit.typed, text: hit.inline }; }
    else cur.text += (cur.text ? '\n' : '') + line;
  }
  flush();
  const kept = secs.filter((s) => s.text !== '');   // the pinned empty-heading drop
  const expectedText = kept.map((s) => `${s.label ?? ''}\n${s.text}`).join('\n') + '\n' + disclaimer;
  const therapyPars = kept
    .filter((s) => s.key === 'Вашата терапия')
    .flatMap((s) => s.text.split(/\n{2,}/))
    .filter((p) => p.trim()).length;
  return {
    tokens: tokens(expectedText),
    colons: (expectedText.match(/:/g) ?? []).length,
    spacedDashes: (expectedText.match(/ [—–-] /g) ?? []).length,
    therapyPars,
  };
}

const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

/** The declarations of one CSS class rule in the emitted stylesheet. */
function cssRule(html: string, selector: string): string {
  // ascii-safe: CSS selector syntax in our own emitted stylesheet
  const m = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`).exec(html);
  return m ? m[1] : '';
}

/** The tail element's OWN markup, read by balanced div-depth — not a slice to
 *  end-of-document. A refuter moved the footer outside the tail and the old
 *  `html.slice(indexOf(tail))` check kept passing, because everything after
 *  the opening tag was „inside" by construction. */
function tailInner(html: string): string {
  const open = html.indexOf('<div class="tail">');
  if (open < 0) return '';
  const re = /<div[\s>]|<\/div>/g;
  re.lastIndex = open;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[0] === '</div>') {
      if (--depth === 0) return html.slice(open, m.index);
    } else depth++;
  }
  return '';
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
  // ── S21–S29: the refuter round of 2026-08-31, one shape per finding ───────
  { id: 'S21 single newlines throughout — the disclaimer stays a line, not the note', summary: `Какво установихме:\nОстър бронхит.\nВашата терапия:\nАмоксицилин 500 мг — по 1 капсула три пъти дневно. Приемайте я с храна.\nНа какво да обърнете внимание:\nПри задух потърсете лекар незабавно.\n${DISCLAIMER}` },
  { id: 'S22 a dose range across the dash is a range, not a regimen', summary: `Вашата терапия:\nПарацетамол 500 мг по 1 – 2 таблетки при болка. Не повече от шест дневно.\n\n${DISCLAIMER}` },
  { id: 'S23 a threshold range in the warning', summary: `На какво да обърнете внимание:\nПри температура над 38 — 38.5 приемете парацетамол и се обадете.\n\n${DISCLAIMER}` },
  { id: 'S24 a dashed bullet list under a drug name', summary: `Вашата терапия:\nАспирин Протект 100 мг\n— по 1 таблетка сутрин\n— след храна\n\n${DISCLAIMER}` },
  { id: 'S25 an abbreviation dot is not a sentence boundary', summary: `Вашата терапия:\nМетопролол 50 мг — по 1 табл. сутрин и вечер след храна.\n\n${DISCLAIMER}` },
  { id: 'S26 the marker phrase mid-text stays mid-text', summary: `Какво установихме:\n${FINDINGS}\n\nПомнете: този документ не замества медицинска консултация при влошаване — елате отново.\n\nСледващи стъпки:\nКонтролен преглед след две седмици.\n\n${DISCLAIMER}` },
  { id: 'S27 an empty-bodied heading is dropped whole — the pinned exception', summary: `Какво установихме:\n${FINDINGS}\n\nНа какво да обърнете внимание:\n\n${DISCLAIMER}` },
  { id: 'S28 a note that talks ABOUT the colours', summary: `Какво установихме:\nВ документа не се използва червено #C0392B, а рамките са #C2CAD4 по дизайн.\n\n${DISCLAIMER}` },
  { id: 'S29 colons and dashes mid-sentence survive', summary: `Следващи стъпки:\nЕлате на 14.09 в 10:30 часа: носете дневника — и списъка с лекарства.\n\n${DISCLAIMER}` },
];

// ── 1 + 2 + 3, across the whole catalogue ───────────────────────────────────

for (const { id, summary } of SHAPES) {
  test(`${id}: conserved, red-free, tokens defined once`, () => {
    const html = buildPatientSummaryHtml(summary, DATE, IDENTITY);
    const style = styleSheet(html);
    const vis = visibleText(html);
    const want = expectedDoc(summary);

    // Conservation, three ways. Tokens: every input token reaches the sheet,
    // in the contract's order. Colons: exact — only matched heading lines
    // give theirs up, and the model already subtracted those. Spaced dashes:
    // bounded — the therapy card absorbs at most one per paragraph, and
    // nothing else may touch one.
    assert.ok(isSubsequence(want.tokens, tokens(vis)),
      `the printed sheet lost or reordered text of the summary (${id})`);
    assert.equal((vis.match(/:/g) ?? []).length, want.colons,
      'a colon the doctor wrote is gone (or one was invented) outside the matched headings');
    const dashesOut = (vis.match(/ [—–-] /g) ?? []).length;
    assert.ok(dashesOut <= want.spacedDashes, 'a spaced dash was invented');
    assert.ok(dashesOut >= want.spacedDashes - want.therapyPars,
      `spaced dashes fell from ${want.spacedDashes} to ${dashesOut} with only ` +
      `${want.therapyPars} therapy paragraph(s) to absorb them`);

    // The reserved red appears nowhere in the STYLING — content is data.
    assert.ok(!RESERVED_RED.test(style),
      'the patient sheet spends #C0392B — red is reserved for medication-safety alerts');

    // The two print tokens: one definition, referenced everywhere else.
    for (const [hex, name] of [['#C2CAD4', 'print-rule'], ['#E8EFF7', 'print-med-fill']] as const) {
      assert.equal(count(style.toUpperCase(), hex), 1,
        `${hex} must appear exactly once (the --${name} definition), not be repeated as a literal`);
      assert.ok(style.includes(`var(--${name})`), `--${name} is defined but never referenced`);
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

test('S21: a single-newline note keeps its sections — the disclaimer is one line', () => {
  // The refuter's worst find: with single newlines throughout, the whole note
  // was ONE paragraph, the paragraph-grain disclaimer pull took all of it, and
  // the red flags printed as 14px italic legal fine print.
  const html = buildPatientSummaryHtml(SHAPES[20].summary, DATE, IDENTITY);
  assert.ok(html.includes('class="warn"'), 'the warning section vanished into the fine print');
  assert.ok(html.includes('class="med-name"'), 'the therapy card vanished into the fine print');
  assert.equal(count(html, 'class="disclaimer"'), 1);
  const disc = /<p class="disclaimer">([\s\S]*?)<\/p>/.exec(html)![1];
  assert.ok(!disc.includes('Амоксицилин'), 'clinical content rendered as the legal fine print');
});

test('dose and threshold ranges keep their dashes — a range is not a regimen', () => {
  const s22 = visibleText(buildPatientSummaryHtml(SHAPES[21].summary, DATE, IDENTITY));
  assert.ok(s22.includes('по 1 – 2 таблетки'), 'the dose range was split as name — regimen');
  const s23 = visibleText(buildPatientSummaryHtml(SHAPES[22].summary, DATE, IDENTITY));
  assert.ok(s23.includes('над 38 — 38.5 приемете'), 'the threshold range was split');
});

test('a dashed bullet list is not absorbed, and an abbreviation dot does not cut', () => {
  const s24 = visibleText(buildPatientSummaryHtml(SHAPES[23].summary, DATE, IDENTITY));
  assert.ok(/—\s*по 1 таблетка сутрин/.test(s24), 'the first bullet dash was eaten across the newline');
  const s25 = visibleText(buildPatientSummaryHtml(SHAPES[24].summary, DATE, IDENTITY));
  assert.ok(s25.includes('по 1 табл. сутрин и вечер'), 'the regimen was cut at the abbreviation dot');
});

test('S26: a marker phrase mid-text renders in place, before the next section', () => {
  const html = buildPatientSummaryHtml(SHAPES[25].summary, DATE, IDENTITY);
  const midAt = html.indexOf('Помнете');
  const nextAt = html.indexOf('Следващи стъпки');
  const discAt = html.indexOf('class="disclaimer"');
  assert.ok(midAt >= 0 && nextAt >= 0 && discAt >= 0);
  assert.ok(midAt < nextAt, 'the mid-text sentence was relocated to the footer');
  assert.ok(html.indexOf('При въпроси или влошаване') > discAt,
    'the real trailing disclaimer still lands in the footer');
});

test('every colour in the stylesheet is a token definition or white — whitelist, not denylist', () => {
  // A refuter walked `rgb(192 57 43)` — the reserved red in space syntax —
  // past the comma-only denylist and repainted the letterhead in it, 582/582
  // green. A denylist of spellings is not a rule about colours (the same
  // lesson as `Date()` without `new`, one gate over). The rule now: every
  // colour literal is a 6-digit-hex token definition far from the reserved
  // red, plus #FFFFFF; a colour FUNCTION of any kind is refused outright.
  const style = styleSheet(buildPatientSummaryHtml(MINIMAL, DATE, IDENTITY));
  const defs = [...style.matchAll(/--print-[a-z-]+:\s*([^;}]+)/g)].map((m) => m[1].trim());
  assert.ok(defs.length >= 8, 'the token map shrank');
  for (const v of defs) {
    assert.match(v, /^#[0-9A-F]{6}$/i,
      `token value ${JSON.stringify(v)} is not a 6-digit hex — a colour space this gate cannot read is refused outright`);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
    assert.ok(Math.abs(r - 192) + Math.abs(g - 57) + Math.abs(b - 43) >= 60,
      `token ${v} sits within reach of the reserved red #C0392B`);
  }
  const rest = style.replace(/:root\s*\{[^}]*\}/, '');
  for (const h of rest.match(/#[0-9a-fA-F]{3,8}/g) ?? []) {
    assert.equal(h.toUpperCase(), '#FFFFFF', `a colour literal outside the token map: ${h}`);
  }
  assert.ok(!/(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/i.test(style),
    'a colour function — the whitelist reads hexes, so a function is refused outright');
});

test('the gated properties admit only their contract values, whatever the selector', () => {
  // A refuter appended `.warn, .warn-item, .tail, .med-card { break-inside:
  // auto }` at the END of the sheet: cssRule() reads the FIRST block per
  // class, the cascade obeys the LAST, so every avoid this gate reads was
  // overridden while 582/582 stayed green. Beyond the per-class pins, the
  // sheet may therefore not contain ANY break-inside except avoid, any
  // print-color-adjust except exact, the legacy alias at all, or the makings
  // of a vertical spacer (the flex-grow respelling of the mock's `flex: 1`).
  const style = styleSheet(buildPatientSummaryHtml(MINIMAL, DATE, IDENTITY));
  // `(?!\s*value)` owns the whitespace: with `\s*(?!value)` the quantifier
  // backtracks to zero and the lookahead passes on the space itself.
  assert.ok(!/break-inside:(?!\s*avoid)/.test(style), 'a break-inside other than avoid');
  assert.ok(!/page-break-inside/.test(style), 'the legacy alias overrides behind the gate\'s back');
  assert.ok(!/print-color-adjust:(?!\s*exact)/.test(style), 'a print-color-adjust other than exact');
  assert.ok(!/flex-grow|min-height/.test(style), 'a spacer in the making');
  assert.ok(!/flex:(?!\s*none)/.test(style), 'a flex: shorthand other than none');
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
  // Read by balanced div-depth, not by slicing to end-of-document: a refuter
  // moved the footer to just AFTER the tail's closing tag and the old slice
  // called everything past the opening tag „inside".
  const html = buildPatientSummaryHtml(MINIMAL, DATE, IDENTITY);
  const tail = tailInner(html);
  assert.ok(tail.length > 0, 'no tail element at all');
  assert.ok(tail.includes('class="disclaimer"') && tail.includes('class="footer"'),
    'the legal line can end up alone on a page with no clinical content above it');
  // …and the tail carries the LAST content block with them, so the group is
  // anchored to content, not floating after it.
  assert.ok(tail.includes('class="warn"') || tail.includes('class="sec"'),
    'the tail holds no content block — the footer group is separable again');
});

test('RED: the tail reader sees a footer moved past the closing tag', () => {
  const outside =
    '<div class="tail">\n<section class="warn">x</section>\n</div>\n' +
    '<p class="disclaimer">d</p>\n<div class="footer">f</div>';
  const tail = tailInner(outside);
  assert.ok(tail.includes('class="warn"'));
  assert.ok(!tail.includes('class="disclaimer"') && !tail.includes('class="footer"'),
    'the reader still slices to end-of-document');
  // …and nested divs do not end the tail early.
  const nested = '<div class="tail"><div><div class="footer">f</div></div></div>';
  assert.ok(tailInner(nested).includes('class="footer"'));
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

test('RED: the reserved-red detector fires on every spelling it names…', () => {
  const html = buildPatientSummaryHtml(MINIMAL, DATE, IDENTITY);
  for (const inject of ['#C0392B', '#c0392b', 'rgb(192, 57, 43)', 'rgb(192,57,43)', 'rgb(192 57 43)']) {
    assert.ok(RESERVED_RED.test(styleSheet(html.replace('</style>', `.warn{color:${inject}}</style>`))),
      `not caught: ${inject}`);
  }
  // …and the module source is held too, not only the output.
  assert.ok(!RESERVED_RED.test(DOCSRC), 'the reserved red is in lib/patient-summary-doc.ts itself');
  assert.ok(RESERVED_RED.test(DOCSRC + '// const warn = "#C0392B"'), 'the source check is alive');
});

test('RED: …and the whitelist refuses what no denylist could spell', () => {
  const html = buildPatientSummaryHtml(MINIMAL, DATE, IDENTITY);
  for (const evil of ['hsl(6 63% 46%)', 'oklch(0.5 0.15 25)', 'hwb(6 12% 15%)', '#C13A2C', 'color(srgb 0.75 0.22 0.17)']) {
    const style = styleSheet(html.replace('</style>', `.x{color:${evil}}</style>`));
    const rest = style.replace(/:root\s*\{[^}]*\}/, '');
    const strayHex = (rest.match(/#[0-9a-fA-F]{3,8}/g) ?? []).some((h) => h.toUpperCase() !== '#FFFFFF');
    const fn = /(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/i.test(rest);
    assert.ok(strayHex || fn, `slipped past the whitelist: ${evil}`);
  }
});

test('RED: the oracle models the three published rules, independently', () => {
  // Empty heading → dropped whole.
  assert.deepEqual(expectedDoc('Какво установихме:').tokens, []);
  // Single-newline note → sections survive, disclaimer is the one line.
  const single = expectedDoc(`Какво установихме:\nБронхит.\n${DISCLAIMER}`);
  assert.ok(single.tokens.includes('Бронхит.'));
  assert.equal(single.tokens[single.tokens.length - 1], 'лекар.');
  // Mid-text marker → stays in place (its tokens precede the next section's).
  const mid = expectedDoc(SHAPES[25].summary);
  assert.ok(mid.tokens.indexOf('Помнете') < mid.tokens.indexOf('Следващи'));
});

test('RED: the separator arithmetic sees a document stripped of dashes and colons', () => {
  const S = SHAPES[28].summary; // S29 — colons and dashes mid-sentence
  const html = buildPatientSummaryHtml(S, DATE, IDENTITY);
  const want = expectedDoc(S);
  const vis = visibleText(html);
  assert.equal((vis.match(/:/g) ?? []).length, want.colons, 'green on the honest document first');
  assert.ok(want.spacedDashes - want.therapyPars >= 1, 'the shape must carry an unabsorbable dash');
  const stripped = vis.replace(/ [—–-] /g, ' ').replace(/:/g, '');
  assert.notEqual((stripped.match(/:/g) ?? []).length, want.colons, 'colon deletion invisible');
  assert.ok((stripped.match(/ [—–-] /g) ?? []).length < want.spacedDashes - want.therapyPars,
    'dash deletion invisible');
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
  const want = expectedDoc(MINIMAL).tokens;
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
