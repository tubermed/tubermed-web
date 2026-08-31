// ─────────────────────────────────────────────────────────────────────────────
// What the printed document actually says — every date-shaped run in it.
//
// THE MEASUREMENT THAT PROMPTED THIS FILE
//
// The summary-date report said `openPdfPreview` in lib/exporters.ts carried six
// lines that stamped a corner date onto every document the product emits. That
// reads as a live defect. It is not one: those six lines were a refuter's
// MUTATION, injected to show that round 1's gate never read the file. Measured
// on this branch and on master, `openPdfPreview` contains no date machinery at
// all — it opens a window, injects an afterprint-close script, optionally hides
// `.actions`, and writes. Item 1 was a gate hole, and this file closes it.
//
// WHY THE GATE CHANGES SHAPE
//
// Two rounds asserted the print output as a SUBSTRING — „does `Дата:` carry the
// визит date". That question cannot see:
//   · a date in `<title>`, which Chrome draws into the printed margin;
//   · a date in a corner element the assertion never names — the report's own
//     example, `<div class="issued">2026-08-28</div>`, passed all three gates;
//   · a date added by a file the gate did not enumerate.
// So the subject here is the WHOLE emitted document, start to finish, and the
// question is inverted: enumerate every date-shaped run anywhere in it, and
// require each one to be the консултация's own. A run the author did not think
// of is still a run.
//
// AND WHY IT DOES NOT ENUMERATE FILES
//
// „Add lib/exporters.ts to the file set" is the same mistake one file later. A
// gate that hand-lists its inputs is only ever as complete as the last person's
// memory of the call graph. This one WALKS the import graph from the builders
// and holds every file it reaches — so a helper added tomorrow is covered the
// day it is imported, without anyone remembering to add it here.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

// Same local sync resolve hook as the sibling date tests — lib/exporters.ts
// uses extensionless relative imports.
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

const { generatePdfHtml, generateEchoHtml, generateWordHtml, openPdfPreview } =
  await import('../lib/exporters.ts');
const { buildPatientSummaryHtml } = await import('../lib/patient-summary-doc.ts');
const { formatVisitDateBg } = await import('../lib/date.ts');

// The note of the лист round: recorded 08.08.2026, reopened three weeks later.
const VISIT_ISO = '2026-08-08T09:12:00.000Z';
const VISIT_BG = formatVisitDateBg(VISIT_ISO);          // '08.08.2026 г.'
const VISIT_DIGITS = '08.08.2026';
// Deliberately a different day, month AND year from the визит: a clock leak
// that happens to share the visit's month would otherwise read as a pass.
const CLOCK_ISO = '2027-11-23T08:00:00.000Z';
const CLOCK_DIGITS = '23.11.2027';

/** Run `fn` with the wall clock frozen at `iso`. `new Date(x)` still parses.
 *
 *  A Proxy, not `class Frozen extends Date`: `Date()` called WITHOUT `new` is
 *  legal JS returning today as a string, and a class constructor throws on it —
 *  so a subclass kills that mutation by TypeError instead of by assertion,
 *  which is an instrument reporting a pass it did not earn. Lifted verbatim
 *  from scripts/summary-date.test.ts, where it was written for exactly the
 *  spelling that beat the first round's denylist. */
function atClock<T>(iso: string, fn: () => T): T {
  const Real = globalThis.Date;
  const fixed = Real.parse(iso);
  const Frozen = new Proxy(Real, {
    construct(target, args: unknown[]) {
      return args.length === 0 ? new target(fixed) : Reflect.construct(target, args);
    },
    apply() {
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

// ── 1. The enumerator ───────────────────────────────────────────────────────
// Over-broad ON PURPOSE. Its job is to find a date the author did not intend to
// be one, so it cannot be a list of the spellings we already know about: bare
// four-digit years and bare HH:MM are in, and every match is reported with the
// region of the document it sits in.

const BG_MONTHS =
  'януари|февруари|март|април|май|юни|юли|август|септември|октомври|ноември|декември';
const EN_MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December' +
  '|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';

const PATTERNS: Array<[string, RegExp]> = [
  ['numeric d.m.y', /\d{1,4}\s*[.\/-]\s*\d{1,2}\s*[.\/-]\s*\d{2,4}/g],
  // `u`-flagged and Cyrillic — no ASCII word boundary is involved.
  ['bg month name', new RegExp(`(?:${BG_MONTHS})`, 'giu')],
  // ascii-safe: English month names, matched against Latin text only.
  ['en month name', new RegExp(`\\b(?:${EN_MONTHS})\\b`, 'g')],
  ['bare year', /\b(?:19|20)\d{2}\b/g],   // ascii-safe: digits
  ['clock time', /\b\d{1,2}:\d{2}(?::\d{2})?\b/g], // ascii-safe: digits
  ['iso timestamp', /\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/g],
];

export interface DateRun { kind: string; text: string; index: number; region: string; ctx: string }

/** Every date-shaped run in `html`, wherever it sits — body, `<title>`, an
 *  attribute, a style block, a corner element nobody named. */
function dateRuns(html: string): DateRun[] {
  const hits: DateRun[] = [];
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const before = html.slice(0, m.index);
      const lastOpen = before.lastIndexOf('<');
      const lastClose = before.lastIndexOf('>');
      let region = 'text';
      if (lastOpen > lastClose) region = 'attribute';
      if (/<title>[^<]*$/i.test(before)) region = 'title';
      // ascii-safe: an HTML tag name, which is Latin by the HTML spec
      else if (/<style\b[^>]*>(?:(?!<\/style>)[\s\S])*$/i.test(before)) region = 'style';
      hits.push({
        kind, text: m[0], index: m.index, region,
        ctx: html.slice(Math.max(0, m.index - 55), m.index + m[0].length + 30).replace(/\s+/g, ' '),
      });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Every date-shaped run inside a value the builder was HANDED, at any depth.
 *
 *  This is what makes the rule below a conservation law instead of a false one.
 *  „Every date in the document is the визит's" is simply not true of a real
 *  лист: `lib/pacemaker-template.ts` renders „Дата на имплантация", so a note
 *  with a pacemaker block correctly prints 12.03.2019 in its body. The first
 *  version of this gate would have gone red on correct output the day anyone
 *  put a realistic fixture in front of it — it passed only because its fixture
 *  happened to contain no dates, which is a gate agreeing with itself.
 *
 *  So the question is not „is this run the визит's" but „did the builder INVENT
 *  this run". A date the доктор dictated belongs on the document; a date that
 *  appears in the output and in no input came from the clock. */
function runsInInput(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    for (const r of dateRuns(value)) into.add(r.text);
  } else if (Array.isArray(value)) {
    for (const v of value) runsInInput(v, into);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) runsInInput(v, into);
  }
  return into;
}

/** A run is accounted for if it is the визит's own date, or a fragment of it,
 *  or something the builder was handed.
 *
 *  Fragments are matched against the визит string ANCHORED, not by substring:
 *  `VISIT_DIGITS.includes('2026')` is true, so a bare „2026" arriving from
 *  anywhere at all used to read as „the визит's". It now has to actually be a
 *  piece of the визит date at the position it claims. */
function accountedFor(r: DateRun, allowed: Set<string>): boolean {
  if (r.text === VISIT_DIGITS) return true;
  if (allowed.has(r.text)) return true;
  // A fragment of the визит date, in place: '08.08.2026' → '2026', '08.08'…
  const i = VISIT_DIGITS.indexOf(r.text);
  return i >= 0 && VISIT_BG.includes(r.text) &&
    (i === 0 || !/\d/.test(VISIT_DIGITS[i - 1])) &&
    (i + r.text.length >= VISIT_DIGITS.length || !/\d/.test(VISIT_DIGITS[i + r.text.length]));
}

const describe = (rs: DateRun[]) =>
  rs.map((r) => `${r.region}/${r.kind}: ${JSON.stringify(r.text)} … ${r.ctx}`).join('\n');

// ── 2. The documents, built whole ───────────────────────────────────────────
// Synthetic content throughout: no stored clinical text, no identity, and the
// probe prints none of either.
//
// The fixture deliberately CONTAINS dates — a pacemaker implantation date, a
// referral date, a date the doctor dictated into the анамнеза. A fixture with
// no dates in it lets „every date in the document is the визит's" pass while
// being false about every real note, which is the shape a gate takes when it
// has only ever been shown the case it was written for.

const FIELDS = {
  osnovna_diagnoza: 'Остър фарингит',
  osnovna_mkb: 'J02.9',
  osnovna_mkb_term: 'Остър фарингит, неуточнен',
  pridruzhavashti: [{ diagnoza: 'Есенциална хипертония', mkb: 'I10' }],
  // A date the doctor dictated. It belongs on the лист and is not the визит's.
  anamneza: 'Оплаквания от болки в гърлото от три дни. Последен преглед 14.02.2025 г.',
  obektivno: 'Хиперемирана фаринкс.',
  izsledvania: 'CRP 12 mg/L, взета на 07.08.2026 г.',
  naznacheni: 'ПКК с ДКК.',
  terapia: 'Симптоматично лечение.',
  medications_list: [{ name: 'парацетамол', dose: '500 mg', regimen: '3 пъти дневно' }],
  napravlenia: 'Бл. 3 — за консултация с УНГ.',
  // The embedded block that renders „Дата на имплантация" — see
  // lib/pacemaker-template.ts. This row is why the rule below had to become a
  // conservation law: the лист prints 12.03.2019 here, correctly.
  izsledvania_blocks: [{
    type: 'pacemaker',
    template: 'pacemaker-v1',
    fields: {
      ustroistvo: {
        tip: 'двукамерен пейсмейкър',
        data_implantatsia: '12.03.2019 г.',
        rezhim: 'DDD',
      },
      bateria: { status: 'OK' },
    },
  }],
  alergii: [],
  _disclaimer: 'Изготвен с помощта на софтуер и прегледан от лекар.',
};
const ECHO_FIELDS = { ...FIELDS, zaklyuchenie: 'Нормални размери. ФИ 60%.' };
const IDENTITY = {
  practiceName: 'АИППМП „Пример" ЕООД', address: 'гр. София, ул. „Примерна" 1',
  phone: '+359 2 000 0000', rziNumber: '2212345678', nzokContract: '221234',
  doctorName: 'д-р Пример Примеров', specialty: 'Обща медицина', uin: '2200001234',
};
const SUMMARY_BODY = 'Прегледът мина добре.\n\nПийте много течности.';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Every document the product emits, built under a clock that is NOT the визит,
 *  each paired with the inputs it was handed.
 *
 *  Built INSIDE the freeze so a builder that reaches for the clock reaches for
 *  23.11.2027 and is caught, rather than silently agreeing with today. */
const documents = (): Array<{ id: string; html: string; input: unknown }> =>
  atClock(CLOCK_ISO, () => [
    { id: 'амбулаторен лист (Печат/PDF)', input: [FIELDS, IDENTITY],
      html: generatePdfHtml(FIELDS as any, VISIT_BG, IDENTITY) },
    { id: 'амбулаторен лист (Word)', input: [FIELDS, IDENTITY],
      html: generateWordHtml(FIELDS as any, VISIT_BG, IDENTITY) },
    { id: 'ехокардиография', input: ECHO_FIELDS,
      html: generateEchoHtml(ECHO_FIELDS as any, VISIT_BG) },
    // The резюме now renders a doctor letterhead (Вариант A, 2026-08-31), so
    // the identity is part of what it was handed — same conservation rule.
    { id: 'резюме за пациента', input: [SUMMARY_BODY, IDENTITY],
      html: buildPatientSummaryHtml(SUMMARY_BODY, VISIT_BG, IDENTITY) },
  ]);
/* eslint-enable @typescript-eslint/no-explicit-any */

for (const doc of documents()) {
  test(`the ${doc.id} introduces no date it was not given`, () => {
    const allowed = runsInInput(doc.input);
    const runs = dateRuns(doc.html);
    const invented = runs.filter((r) => !accountedFor(r, allowed));
    assert.equal(invented.length, 0,
      `the document carries ${invented.length} date-shaped run(s) that are neither the визит's ` +
      `nor anything it was handed:\n${describe(invented)}`);
    // A document that suddenly has NO date at all is a different defect, and
    // this assertion is what stops the enumeration above from passing vacuously.
    assert.ok(runs.some((r) => r.text === VISIT_DIGITS),
      `the ${doc.id} carries no визит date at all — the enumeration above passed on an empty document`);
  });
}

test('the лист really does print the dates it was given, so the law is not vacuous', () => {
  // The conservation law is only worth having if content dates actually reach
  // the document — otherwise „allowed" is unused and the rule is the old, false
  // one wearing a new name. All three fixture dates must be on the лист.
  const list = documents()[0].html;
  for (const d of ['12.03.2019', '14.02.2025', '07.08.2026']) {
    assert.ok(list.includes(d), `the fixture's ${d} does not reach the лист — pick a field that prints`);
  }
  assert.ok(runsInInput(FIELDS).has('12.03.2019'),
    'the input reader does not descend into izsledvania_blocks');
});

test('the clock is genuinely frozen while the documents are built', () => {
  // Without this the four assertions above prove nothing: if `atClock` did not
  // bite, a builder reaching for `new Date()` would produce TODAY, and today is
  // not `CLOCK_DIGITS`, so the leak would be reported as „other" but would also
  // change every time this suite is run.
  const seen = atClock(CLOCK_ISO, () => new Date().toISOString());
  assert.equal(seen, CLOCK_ISO);
  assert.equal(atClock(CLOCK_ISO, () => formatVisitDateBg(new Date().toISOString())),
    '23.11.2027 г.');
});

// ── 3. The shared funnel, as a document rather than as a file ───────────────

/** openPdfPreview's transformation, applied to a real document. The gate reads
 *  the funnel's OUTPUT, not its source: the previous round asserted the source
 *  and a mutation to the same file is what it was asked to catch. */
test('openPdfPreview adds no date to any document, on EITHER of its branches', () => {
  // Both branches, not one. `autoPrint` selects between two different documents:
  // with it the funnel injects `hideActionsCss`, without it that string is ''.
  // „Печат" passes { autoPrint: true }; „Преглед / PDF" (result page 1597) and
  // the echo preview (1576) pass NOTHING. The first version of this test
  // exercised only the autoPrint branch — so a stamp put in the else-branch
  // stayed green, in the file written precisely because a refuter mutated this
  // function. One call is not coverage of a function with a branch in it.
  const CALLS: Array<[string, { autoPrint?: boolean } | undefined]> = [
    ['Печат (autoPrint)', { autoPrint: true }],
    ['Преглед / PDF (no options)', undefined],
    ['explicit autoPrint: false', { autoPrint: false }],
  ];
  const opened: string[] = [];
  const realOpen = (globalThis as { window?: unknown }).window;
  // A window stub thin enough that openPdfPreview's whole body runs and the
  // document it writes is captured verbatim.
  (globalThis as { window?: unknown }).window = {
    open: () => ({
      document: { write: (s: string) => opened.push(s), close() {}, readyState: 'complete' },
      addEventListener() {}, focus() {}, print() {},
    }),
  };
  try {
    for (const doc of documents()) {
      const allowed = runsInInput(doc.input);
      const written: string[] = [];
      for (const [label, opts] of CALLS) {
        opened.length = 0;
        const ok = atClock(CLOCK_ISO, () => openPdfPreview(doc.html, opts));
        assert.equal(ok, true, `openPdfPreview refused to open the ${doc.id} for ${label}`);
        assert.equal(opened.length, 1, `the ${doc.id} was not written exactly once for ${label}`);
        written.push(opened[0]);
        const invented = dateRuns(opened[0]).filter((r) => !accountedFor(r, allowed));
        assert.equal(invented.length, 0,
          `after the funnel (${label}), the ${doc.id} carries an invented date run:\n${describe(invented)}`);
      }
      // …and the two branches really do produce different documents, or the
      // three calls above are one call repeated and prove nothing extra.
      assert.notEqual(written[0], written[1],
        'autoPrint made no difference to the written document — the branch is not being exercised');
      assert.equal(written[1], written[2], 'no-options and autoPrint:false are the same branch');
    }
  } finally {
    (globalThis as { window?: unknown }).window = realOpen;
  }
});

// ── 4. The file set the gate does not have to remember ──────────────────────

const DATE_MACHINERY =
  // ascii-safe: JS source identifiers in our own files, never Bulgarian input
  /\bDate\s*\(|\bDate\s*\.\s*(?:now|parse|UTC)|toLocaleDate|toLocaleTime|toLocaleString|DateTimeFormat|formatVisitDateBg|formatDateTimeBg|formatDateBg|sofiaDayIso|todaySofiaIso|getFullYear\(|getMonth\(|getDate\(|\bTemporal\s*\./;

const stripComments = (src: string) =>
  src.split('\n').filter((l) => !/^\s*(?:\/\/|\/\*|\*)/.test(l)).join('\n');

/** `a/b/./../c` → `a/c`, POSIX separators only. */
function normalisePosix(p: string): string {
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/** Every file reachable by relative import from `entry`, transitively. This is
 *  the gate's file set, and it is DISCOVERED rather than declared. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const rel = stack.pop()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    const src = read(rel);
    const dir = dirname(rel);
    // ascii-safe: an ES import/export specifier, always Latin in this repo
    const re = /(?:from|import)\s*['"](\.[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      // Repo-relative, POSIX-separated throughout: `join`/`resolve` produce
      // backslashes and a drive letter on Windows, and the resulting keys then
      // match nothing on disk — which is how the first version of this walk
      // reached its own two roots and stopped. The guard below is what caught it.
      const base = normalisePosix(dir + '/' + m[1]);
      const cand = [base, base + '.ts', base + '.tsx', base + '/index.ts']
        .find((c) => /\.tsx?$/.test(c) && existsSync(join(ROOT, c)));
      if (cand) stack.push(cand);
    }
  }
  return [...seen].sort();
}

// Rooted at the two modules that BUILD documents. Everything they reach is part
// of what the document says, so everything they reach is held to the same rule.
const BUILDER_GRAPH = [
  ...new Set([...importGraph('lib/exporters.ts'), ...importGraph('lib/patient-summary-doc.ts')]),
];

test('the builder graph is discovered, not declared', () => {
  // A graph walk that silently found nothing would make the next test vacuous.
  assert.ok(BUILDER_GRAPH.includes('lib/exporters.ts'));
  assert.ok(BUILDER_GRAPH.includes('lib/patient-summary-doc.ts'));
  assert.ok(BUILDER_GRAPH.length >= 5,
    `the walk reached only ${BUILDER_GRAPH.length} file(s): ${BUILDER_GRAPH.join(', ')}`);
  // The graph must reach past its own roots, or it is a hand-list with extra
  // steps. lib/exporters.ts imports four sibling modules.
  assert.ok(BUILDER_GRAPH.some((f) => f !== 'lib/exporters.ts' && f !== 'lib/patient-summary-doc.ts'
    && f.startsWith('lib/')));
});

test('no file that builds a document owns any date machinery', () => {
  const guilty = BUILDER_GRAPH.filter((f) => DATE_MACHINERY.test(stripComments(read(f))));
  assert.deepEqual(guilty, [],
    `these files build a printed document and reach for a date: ${guilty.join(', ')}. ` +
    'A document\'s date arrives as an argument, resolved once by lib/date.ts at the call site.');
});

// ── 5. Red proof — the instrument, against what it is supposed to catch ─────
// Every shape below is one that the substring gates of rounds 1 and 2 let past.

const listHtml = () => documents()[0].html;
/** What the лист was legitimately handed — the fixture's own content dates.
 *  Every RED below adds a run that is in neither this set nor the визит date. */
const listAllowed = () => runsInInput(documents()[0].input);
const invented = (html: string) =>
  dateRuns(html).filter((r) => !accountedFor(r, listAllowed()));

test('RED: a stamp in <title>, which Chrome draws into the printed margin', () => {
  const mutant = listHtml().replace('</title>', ` · издаден ${CLOCK_DIGITS}</title>`);
  const found = invented(mutant);
  assert.ok(found.length > 0, 'a date in <title> went unseen');
  assert.ok(found.some((r) => r.region === 'title'), 'the run was found but not located in <title>');
});

test('RED: the corner element the report named — <div class="issued">', () => {
  // Verbatim the shape that „passed all three" gates in the summary-date round.
  const mutant = listHtml().replace('<div class="doc">',
    `<div class="doc"><div class="issued">2026-08-28</div>`);
  const found = invented(mutant);
  assert.ok(found.length > 0, 'the corner stamp went unseen');
  assert.ok(found.some((r) => r.text === '2026-08-28'));
});

test('RED: a date hidden in an attribute rather than in text', () => {
  const mutant = listHtml().replace('<div class="doc">',
    `<div class="doc" data-issued="23/11/2027" title="издаден 23.11.2027">`);
  const found = invented(mutant);
  assert.ok(found.length > 0, 'a date in an attribute went unseen');
  assert.ok(found.some((r) => r.region === 'attribute'),
    `the run was found but not located in an attribute: ${describe(found)}`);
});

test('RED: a date written out in words rather than in digits', () => {
  const mutant = listHtml().replace('</body>', '<p>Отпечатан на 28 август 2026 г.</p></body>');
  const found = invented(mutant);
  assert.ok(found.some((r) => r.kind === 'bg month name'),
    `a Bulgarian month name went unseen: ${describe(found)}`);
});

test('RED: a stamp injected by the shared funnel itself', () => {
  // The refuter's mutation, reproduced at the level the gate now works at: the
  // funnel's OUTPUT. Round 1 read three files and none of them was this one.
  const asFunnelWould = (html: string) =>
    html.replace('</body>', `<div style="position:fixed;top:4px;right:6px;font-size:7pt">${CLOCK_DIGITS}</div></body>`);
  assert.ok(invented(asFunnelWould(listHtml())).length > 0,
    'a corner stamp added by the funnel went unseen');
});

test('RED: the graph rule fires on a date reached through an import, not a name', () => {
  // The point of the walk: a file nobody listed. Prove the predicate that
  // guards the graph actually goes red on the machinery it bans, including the
  // two spellings that beat earlier rounds.
  for (const mutant of [
    'const stamp = new Date().toLocaleDateString("bg-BG");',
    'const stamp = Date();',                       // no `new` — legal, returns today
    'const now = Date.now();',
    'const f = new Intl.DateTimeFormat("bg-BG");',
    'const y = d.getFullYear();',
    "import { todaySofiaIso } from './date';",
  ]) {
    assert.ok(DATE_MACHINERY.test(stripComments(mutant)), `not caught: ${mutant}`);
  }
  // …and does NOT fire on the shipped graph, or the test above is vacuous.
  assert.ok(!DATE_MACHINERY.test(stripComments(read('lib/exporters.ts'))));
});

test('RED: the enumerator is not blind to the визит date itself', () => {
  // The counterpart of every RED above: prove a run the gate calls „the визит's"
  // is actually being SEEN, so `foreign.length === 0` never means „saw nothing".
  const runs = dateRuns(listHtml());
  assert.ok(runs.filter((r) => r.text === VISIT_DIGITS).length >= 2,
    'the лист should carry its визит date at least twice — <title> and the header slot');
});

test('RED: the conservation law does not fire on a date the doctor dictated', () => {
  // The inverse failure, and the reason this rule replaced „every run is the
  // визит's". lib/pacemaker-template.ts prints „Дата на имплантация", so a real
  // лист carries content dates that are correct and are not the визит's. A gate
  // that reddens on those is a gate someone will delete.
  const allowed = listAllowed();
  for (const d of ['12.03.2019', '14.02.2025', '07.08.2026']) {
    assert.ok(allowed.has(d), `the fixture date ${d} was not read out of the input`);
    assert.ok(accountedFor({ kind: 'numeric d.m.y', text: d, index: 0, region: 'text', ctx: '' }, allowed),
      `${d} is on the document because it was dictated, and must not be called invented`);
  }
  // But a date in NEITHER the input nor the визит is still invented, or the
  // rule above has simply been widened into permitting everything.
  assert.equal(
    accountedFor({ kind: 'numeric d.m.y', text: CLOCK_DIGITS, index: 0, region: 'text', ctx: '' }, allowed),
    false);
});

test('RED: a bare year is not waved through just because the визит contains one', () => {
  // `VISIT_DIGITS.includes('2026')` is TRUE, so the first version of this rule
  // accepted a bare „2026" arriving from anywhere at all — including a stamp
  // that rendered nothing but a year. Fragments must sit at a digit boundary of
  // the визит date, not merely appear inside it.
  const empty = new Set<string>();
  const run = (text: string): DateRun => ({ kind: 'bare year', text, index: 0, region: 'text', ctx: '' });
  assert.ok(accountedFor(run('2026'), empty), '2026 IS the визит\'s year');
  assert.equal(accountedFor(run('202'), empty), false, '202 is a substring, not a fragment');
  assert.equal(accountedFor(run('8.08'), empty), false, 'cuts across the day boundary');
  assert.equal(accountedFor(run('2025'), empty), false);
  assert.ok(accountedFor(run('2025'), new Set(['2025'])), '…unless it was handed in');
});
