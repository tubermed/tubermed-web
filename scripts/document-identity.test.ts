// ─────────────────────────────────────────────────────────────────────────────
// No patient identity reaches a document this product emits.
//
// WHY THIS IS A GATE AND NOT A CODE REVIEW
//
// `buildPatientSummaryHtml` took a `patientName` that rendered into the printed
// sheet directly above the date cell. Nothing ever passed it — the page did not
// supply the prop, the modal forwarded `undefined`, the element never appeared.
// A dead channel. But the product's non-negotiable invariant is that there is
// no patient identity anywhere in it, and the Trust Pack states that to doctors
// in these words:
//
//   „В приложението няма поле за ЕГН, име или дата на раждане — не можете да ги
//    въведете, дори да поискате."
//
// That sentence was true only because nobody had filled the argument in. One
// call site would have made it false, on the one document that goes home in the
// patient's hand — and it would have looked, at the call site, like passing a
// string. The parameter is deleted; this is what keeps it deleted.
//
// WHAT IT HOLDS, AND WHAT IT DELIBERATELY DOES NOT
//
// It reads the SIGNATURES of every function that builds a document, and the
// document builders' import graph, and rejects any parameter, property or
// interface field whose name is patient-identity-shaped. Doctor and practice
// identity — doctorName, practiceName, УИН, РЗИ, the НЗОК contract, the
// practice address and phone — is legitimate and expected on an амбулаторен
// лист; it is carried by ExportIdentity and is explicitly allowed, by name.
//
// A name gate cannot stop `build(summary, date, s)` where `s` happens to hold a
// name. Nothing static can. What it stops is the shape the defect actually
// took: a NAMED, documented, patient-identity parameter sitting on a document
// builder waiting for a call site — and it stops it at review time, in the
// diff, which is where that one is caught.
//
// WHAT IS STILL OPEN, CONFIRMED RATHER THAN ASSUMED
//
// An adversarial pass drove these through and they are NOT closable by this
// mechanism. They are written down because a gate whose limits are unstated
// gets read as a guarantee:
//
//   1. A generically-named parameter. A 4th argument `subject?: string` on
//      generatePdfHtml, rendering „Пациент: <име>", is green here and always
//      will be. Only review catches it.
//   2. Identity through the DOCTOR-side allowlist. `address` and `phone` are
//      allowed unconditionally because the practice's own address belongs on a
//      лист; a call site that puts the patient's there instead is invisible.
//   3. Free text. Whatever the доктор dictates into `anamneza` reaches paper,
//      the clipboard, the Word file and the summary prompt verbatim. That is
//      by design and is a product question, not a parser one.
//
// The two routes that ARE closed and might look like these: a default parameter
// value (`patientName = ''`) and a relative re-export both go red.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

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

const EXPORTERS = await import('../lib/exporters.ts');
const { buildPatientSummaryHtml } = await import('../lib/patient-summary-doc.ts');

// ── What „patient identity" is spelled like ─────────────────────────────────
// Latin and Cyrillic, because half this codebase is each. The Cyrillic
// alternatives carry no ASCII word boundary — `\b` is ASCII-only and would cut
// in the middle of a Cyrillic word — so they are matched as substrings, which
// is the safe direction for a denylist.

const IDENTITY_LATIN = [
  'patientname', 'patientfullname', 'patient_name', 'fullname', 'firstname',
  'lastname', 'middlename', 'surname', 'familyname', 'givenname', 'initials',
  'egn', 'nationalid', 'personalid', 'personalnumber', 'idcard', 'passportno',
  'dob', 'dateofbirth', 'birthdate', 'birth_date', 'birthday',
  'patientaddress', 'patientphone', 'patientemail', 'patientdob',
  'homeaddress', 'mobilenumber', 'healthinsurancenumber', 'insurednumber',
  // Latin spellings of the Bulgarian words. A verification pass got `pacient`
  // and `imeNaPacienta` onto a document builder with the first list — this
  // codebase names things in transliterated Bulgarian constantly
  // (`osnovna_diagnoza`, `pridruzhavashti`, `napravlenia`), so these are the
  // NATURAL spellings here, not exotic ones.
  'pacient', 'patsient', 'imena', 'imenapacienta', 'imepacient', 'trioimena',
  'egnpacient', 'datanarazhdane', 'rozhdenadata', 'adrespacient', 'lichnakarta',
  // Reversed word order, which defeats a `patientname` substring outright.
  'nameofpatient', 'nameofthepatient', 'egnofpatient', 'patientsname',
];
const IDENTITY_CYRILLIC = [
  'егн', 'име на пациент', 'имена', 'пациентско име', 'дата на раждане',
  'рождена дата', 'адрес на пациент', 'телефон на пациент', 'лична карта',
];

/** Doctor / practice identity. Legitimate on an амбулаторен лист and named here
 *  so the denylist above can never be widened into banning it by accident —
 *  `doctorName` ends in „name" and `practiceName` contains „ceName". */
const DOCTOR_SIDE = new Set([
  'doctorname', 'practicename', 'specialty', 'uin', 'rzinumber', 'nzokcontract',
  'address', 'phone', 'identity', 'exportidentity',
]);

/** True when an identifier is patient-identity-shaped. Case- and
 *  separator-insensitive, so `patient_name`, `patientName` and `PATIENTNAME`
 *  are one thing. */
export function isPatientIdentity(name: string): boolean {
  const flat = name.toLowerCase().replace(/[_\-\s]/g, '');
  if (DOCTOR_SIDE.has(flat)) return false;
  if (IDENTITY_LATIN.some((k) => flat.includes(k.replace(/_/g, '')))) return true;
  const lower = name.toLowerCase();
  return IDENTITY_CYRILLIC.some((k) => lower.includes(k));
}

// ── The builders, read as signatures ────────────────────────────────────────

/** Parameter names of `export function <name>(…)` in `src`, by function. Reads
 *  the SOURCE rather than `Function.length`, because `length` stops at the
 *  first optional parameter — and `patientName?` was optional, so an arity
 *  check alone would have counted the deleted channel as absent. */
function exportedSignatures(src: string): Array<{ fn: string; params: string[] }> {
  const out: Array<{ fn: string; params: string[] }> = [];
  // Three shapes, because a verification pass got a builder past each of the
  // ones the first version did not read:
  //   · `export function f<T>(…)`  — a generic. It was ALREADY losing the
  //     shipped `setEchoPath<T>` in lib/echo-template.ts, so the sweep was
  //     quietly narrower than the file set it claimed to cover.
  //   · `export const f = (…) =>`  — an arrow builder.
  //   · a function with NO return-type annotation. The old pattern required
  //     `): `, and its non-greedy body then ran on to the NEXT function's `):`,
  //     so parameters were reported under the wrong function's name — the same
  //     shape as an earlier round reporting the neighbouring field's key.
  // ascii-safe: TS declaration syntax in our own source
  const re =
    /export\s+(?:async\s+)?(?:function\s+([A-Za-z0-9_$]+)\s*(?:<[^>]*>)?\s*\(|const\s+([A-Za-z0-9_$]+)\s*(?::[^=]*)?=\s*(?:async\s*)?(?:<[^>]*>)?\s*\()/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // Balanced to the matching `)`, so the parameter list ends where it really
    // ends whether or not a return type follows.
    const open = re.lastIndex - 1;
    let depth = 0, close = -1;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
      else if (c === ')' || c === ']' || c === '}' || c === '>') {
        if (c === ')' && depth === 1) { close = i; break; }
        depth--;
      }
    }
    if (close < 0) continue;
    const params = src.slice(open + 1, close)
      .split(/,(?![^<([{]*[>)\]}])/)     // top-level commas only
      .map((p) => p.trim())
      .filter(Boolean)
      // ascii-safe: a TS parameter name, optionally destructured or defaulted
      .map((p) => (/^([A-Za-z0-9_$]+)\s*[?:=]?/.exec(p)?.[1] ?? p));
    out.push({ fn: m[1] ?? m[2], params });
  }
  return out;
}

/** The `{ … }` starting at `from`, brace-balanced. `[^}]*` stops at the FIRST
 *  closing brace, so one nested object type — `logo?: { url: string }` — ends
 *  the body early and every field after it becomes invisible. A verification
 *  pass walked `patientName / egn / dateOfBirth` in behind exactly that. */
function balancedBlock(src: string, from: number): { body: string; end: number } | null {
  if (src[from] !== '{') return null;
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return { body: src.slice(from + 1, i), end: i };
  }
  return null;
}

/** Field names of every object TYPE in `src` — `interface X { … }` and
 *  `type X = { … }` alike. A builder that takes an options OBJECT hides its
 *  parameters from the signature reader above, so the fields are read too, and
 *  `type` is read because the gate's own first red proof used `interface` and
 *  a `type` alias therefore sailed straight through it. */
function interfaceFields(src: string): Array<{ iface: string; field: string }> {
  const out: Array<{ iface: string; field: string }> = [];
  // ascii-safe: a TS interface / type-alias declaration in our own source
  const re = /(?:export\s+)?(?:interface\s+([A-Za-z0-9_$]+)[^{]*|type\s+([A-Za-z0-9_$]+)\s*=\s*)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const block = balancedBlock(src, re.lastIndex - 1);
    if (!block) continue;
    const name = m[1] ?? m[2];
    // Split on `;`, `,` and newlines: newlines alone read only the FIRST field
    // of a single-line type, which is how the red proof below,
    // `{ dateBg: string; patientEgn?: string }`, went green on its own mutation.
    for (const line of block.body.split(/[;,\n]/)) {
      // A quoted key is a key. `'patientName'?: string` is legal TS and the
      // bare-identifier form missed it.
      // ascii-safe: a TS member name, optionally quoted
      const f = /^\s*(?:readonly\s+)?['"`]?([A-Za-z0-9_$]+)['"`]?\s*\??\s*:/.exec(line);
      if (f) out.push({ iface: name, field: f[1] });
    }
  }
  return out;
}

const stripComments = (src: string) =>
  src.split('\n').filter((l) => !/^\s*(?:\/\/|\/\*|\*)/.test(l)).join('\n');

/** The same discovered walk the date gate uses: every file reachable by
 *  relative import from the document builders. A hand-listed set is only ever
 *  as complete as the last person's memory of the call graph. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  const norm = (p: string) => {
    const out: string[] = [];
    for (const seg of p.replace(/\\/g, '/').split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') out.pop(); else out.push(seg);
    }
    return out.join('/');
  };
  while (stack.length) {
    const rel = stack.pop()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    const src = read(rel);
    // Relative AND `@/`-aliased. The alias resolves to the repo root and is the
    // ordinary way a .tsx imports from lib/ — a verification pass put a whole
    // new identity-taking builder in `lib/handout-doc.ts`, imported it as
    // `@/lib/handout-doc`, and the walk never reached the file.
    // ascii-safe: an ES import specifier
    const re = /(?:from|import)\s*['"]((?:\.|@\/)[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const base = m[1].startsWith('@/')
        ? norm(m[1].slice(2))
        : norm(dirname(rel) + '/' + m[1]);
      const cand = [base, base + '.ts', base + '.tsx', base + '/index.ts']
        .find((c) => /\.tsx?$/.test(c) && existsSync(join(ROOT, c)));
      if (cand) stack.push(cand);
    }
  }
  return [...seen].sort();
}

const BUILDER_GRAPH = [
  ...new Set([...importGraph('lib/exporters.ts'), ...importGraph('lib/patient-summary-doc.ts')]),
];

// ── The assertions ──────────────────────────────────────────────────────────

test('no document builder takes a patient-identity parameter', () => {
  const guilty: string[] = [];
  for (const file of BUILDER_GRAPH) {
    for (const { fn, params } of exportedSignatures(stripComments(read(file)))) {
      for (const p of params) {
        if (isPatientIdentity(p)) guilty.push(`${file} → ${fn}(… ${p} …)`);
      }
    }
  }
  assert.deepEqual(guilty, [],
    'a patient-identity parameter reaches a rendered document:\n' + guilty.join('\n') +
    '\nThis product has no field for a patient\'s name, ЕГН or date of birth, and the Trust ' +
    'Pack says so to doctors. Do not add one to a document builder.');
});

test('no interface a document builder reads carries a patient-identity field', () => {
  const guilty: string[] = [];
  for (const file of BUILDER_GRAPH) {
    for (const { iface, field } of interfaceFields(stripComments(read(file)))) {
      if (isPatientIdentity(field)) guilty.push(`${file} → ${iface}.${field}`);
    }
  }
  assert.deepEqual(guilty, [], 'patient identity in a builder\'s input type:\n' + guilty.join('\n'));
});

test('the printable summary takes exactly (summary, dateBg)', () => {
  assert.equal(buildPatientSummaryHtml.length, 2);
  const sigs = exportedSignatures(stripComments(read('lib/patient-summary-doc.ts')));
  const b = sigs.find((s) => s.fn === 'buildPatientSummaryHtml');
  assert.ok(b, 'the builder is no longer an exported function this gate can read');
  assert.deepEqual(b!.params, ['summary', 'dateBg'],
    'the third parameter was `patientName`, a dead identity channel into a printed sheet');
});

test('the modal that prints the summary has no identity prop, and its page passes none', () => {
  const modal = stripComments(read('components/PatientSummaryModal.tsx'));
  const page = stripComments(read('app/app/scribe/result/page.tsx'));
  for (const { iface, field } of interfaceFields(modal)) {
    assert.equal(isPatientIdentity(field), false, `${iface}.${field} is an identity channel`);
  }
  const tags = [...page.matchAll(/<PatientSummaryModal([\s\S]*?)\/>/g)];
  assert.ok(tags.length > 0, 'the modal is no longer rendered where this gate can read its props');
  for (const t of tags) {
    // A SPREAD defeats every name check at once: `{...{ patientName: … }}`
    // passes props this reader never sees. The prop set on this element is
    // small and explicit, so a spread is refused outright rather than parsed.
    assert.ok(!/\{\s*\.\.\./.test(t[1]),
      'a spread on <PatientSummaryModal> hides its prop names — pass props explicitly');
    // ascii-safe: a JSX attribute name in our own source
    const props = [...t[1].matchAll(/([A-Za-z0-9_$]+)\s*=/g)].map((a) => a[1]);
    const bad = props.filter(isPatientIdentity);
    assert.deepEqual(bad, [], `the page passes an identity prop into the printed sheet: ${bad}`);
  }
});

test('the document a patient is handed contains no identity element', () => {
  const html = buildPatientSummaryHtml('Прегледът мина добре.', '08.08.2026 г.');
  assert.ok(!/class="who"/.test(html));
  assert.ok(!/\.who\s*\{/.test(html), 'the style rule went with the element');
  // …and the document is otherwise intact, or the four assertions above pass on
  // a builder that returns nothing.
  assert.ok(html.includes('Резюме за пациента') && html.includes('08.08.2026 г.'));
});

test('doctor and practice identity is untouched — the лист still carries it', () => {
  // The counterpart every denylist needs. A gate that also removed the doctor's
  // name from an амбулаторен лист would break the document it was defending.
  const html = EXPORTERS.generatePdfHtml(
    { osnovna_diagnoza: 'Остър фарингит' } as never, '08.08.2026 г.',
    // No quote characters in the fixture: the builder escapes them, and this
    // test is about whether doctor identity SURVIVES, not about escaping.
    { doctorName: 'д-р Пример Примеров', practiceName: 'АИППМП Пример ЕООД', uin: '2200001234' },
  );
  assert.ok(html.includes('д-р Пример Примеров'));
  assert.ok(html.includes('АИППМП Пример ЕООД'));
  assert.ok(html.includes('2200001234'));
  for (const f of ['doctorName', 'practiceName', 'uin', 'rziNumber', 'nzokContract', 'address', 'phone']) {
    assert.equal(isPatientIdentity(f), false, `${f} is doctor-side and must stay allowed`);
  }
});

// ── Red proof ───────────────────────────────────────────────────────────────

test('RED: the classifier fires on every spelling the channel could return as', () => {
  for (const n of [
    'patientName', 'patient_name', 'PATIENTNAME', 'patient-name', 'patientFullName',
    'fullName', 'firstName', 'lastName', 'surname', 'givenName', 'initials',
    'egn', 'EGN', 'egnNumber', 'nationalId', 'personalNumber', 'idCard',
    'dob', 'DOB', 'dateOfBirth', 'birthDate', 'birth_date', 'birthday',
    'patientAddress', 'patientPhone', 'patientEmail', 'healthInsuranceNumber',
    'ЕГН', 'дата на раждане', 'име на пациента',
  ]) {
    assert.ok(isPatientIdentity(n), `not caught: ${n}`);
  }
});

test('RED: and does NOT fire on what a лист legitimately carries', () => {
  for (const n of [
    'doctorName', 'practiceName', 'specialty', 'uin', 'rziNumber', 'nzokContract',
    'address', 'phone', 'identity', 'summary', 'dateBg', 'dateStr', 'fields',
    'anamneza', 'osnovna_diagnoza', 'medications_list', 'html', 'opts',
  ]) {
    assert.equal(isPatientIdentity(n), false, `false positive: ${n}`);
  }
});

test('RED: the signature reader sees an OPTIONAL parameter', () => {
  // The deleted one was `patientName?: string`. `Function.length` stops at the
  // first optional parameter, so an arity check alone would have reported the
  // channel as absent while it sat there. This reads the source instead.
  const src = `
export function buildPatientSummaryHtml(
  summary: string,
  dateBg: string,
  patientName?: string,
): string { return ''; }`;
  const sig = exportedSignatures(src)[0];
  assert.deepEqual(sig.params, ['summary', 'dateBg', 'patientName']);
  assert.ok(sig.params.some(isPatientIdentity));
});

test('RED: the whole gate goes red on the builder exactly as it was', () => {
  // Verbatim the shape deleted in this commit, plus the two routes a
  // reintroduction would more plausibly take: an options object, and a field on
  // an existing input type.
  const asDeleted = `
export function buildPatientSummaryHtml(
  summary: string,
  dateBg: string,
  patientName?: string,
): string { return ''; }`;
  assert.ok(exportedSignatures(asDeleted)[0].params.some(isPatientIdentity),
    'the deleted parameter must be red, or this file proves nothing');

  const viaOptions = `
export interface SummaryDocOpts { dateBg: string; patientEgn?: string }
export function buildPatientSummaryHtml(summary: string, o: SummaryDocOpts): string { return ''; }`;
  assert.ok(interfaceFields(viaOptions).some((f) => isPatientIdentity(f.field)),
    'an identity field smuggled in through an options object');

  const viaFields = `
export interface TranscribeFields { anamneza?: string; dateOfBirth?: string }`;
  assert.ok(interfaceFields(viaFields).some((f) => isPatientIdentity(f.field)),
    'an identity field added to the note shape the exporters read');

  const viaProp = `
      <PatientSummaryModal isOpen={o} visitDateBg={d} patientName={who} />`;
  const props = [...viaProp.matchAll(/<PatientSummaryModal([\s\S]*?)\/>/g)]
    // ascii-safe: a JSX attribute name
    .flatMap((m) => [...m[1].matchAll(/([A-Za-z0-9_$]+)\s*=/g)].map((a) => a[1]));
  assert.ok(props.some(isPatientIdentity), 'an identity prop re-added at the page');
});

test('RED: the graph walk is not empty, so the two sweeps are not vacuous', () => {
  assert.ok(BUILDER_GRAPH.length >= 5, `walk reached ${BUILDER_GRAPH.length}: ${BUILDER_GRAPH}`);
  assert.ok(BUILDER_GRAPH.includes('lib/exporters.ts'));
  assert.ok(BUILDER_GRAPH.includes('lib/patient-summary-doc.ts'));
  // And it actually finds signatures and interfaces in there — a reader that
  // silently returned [] would make both sweeps green on anything.
  const sigs = BUILDER_GRAPH.flatMap((f) => exportedSignatures(read(f)));
  const ifaces = BUILDER_GRAPH.flatMap((f) => interfaceFields(read(f)));
  assert.ok(sigs.length >= 5, `only ${sigs.length} signature(s) read across the graph`);
  assert.ok(ifaces.length >= 5, `only ${ifaces.length} interface field(s) read across the graph`);
  assert.ok(sigs.some((s) => s.fn === 'generatePdfHtml'));
  assert.ok(ifaces.some((f) => f.iface === 'ExportIdentity' && f.field === 'doctorName'));
});

// ── Red proof — the nine routes a verification pass drove past this gate ────
// Every one of these was demonstrated GREEN against the first version of this
// file, by writing the mutation into the tree and running `npm test`. They are
// held here as fixtures so the readers can never quietly narrow again.

test('RED: a nested object type no longer unroofs the fields after it', () => {
  // `[^}]*` stopped at the first `}`, so ONE inline object type ended the body
  // early and everything below it became invisible.
  const src = `
export interface ExportIdentity {
  doctorName?: string | null;
  logo?: { url: string; alt: string };
  patientName?: string | null;
  egn?: string | null;
  dateOfBirth?: string | null;
}`;
  const fields = interfaceFields(src).map((f) => f.field);
  for (const f of ['patientName', 'egn', 'dateOfBirth']) {
    assert.ok(fields.includes(f), `${f} sits after a nested object type and was not read`);
  }
  assert.ok(fields.includes('logo'), 'the nested field itself is still read');
});

test('RED: a `type` alias is read, not only an `interface`', () => {
  // The gate's own first red proof used `interface`, so a `type` alias walked
  // straight through the thing that was supposed to be proving it.
  const src = `export type PdfOpts = { dateBg: string; patientName?: string; egn?: string };`;
  assert.ok(interfaceFields(src).some((f) => isPatientIdentity(f.field)));
});

test('RED: a quoted key is a key', () => {
  const src = `export interface O { 'patientName'?: string; "egn"?: string; \`dateOfBirth\`?: string }`;
  const fields = interfaceFields(src).map((f) => f.field);
  for (const f of ['patientName', 'egn', 'dateOfBirth']) assert.ok(fields.includes(f), f);
});

test('RED: a GENERIC exported function is read', () => {
  const src = `
export function buildSheetHeader<T extends TranscribeFields>(
  f: T, dateStr: string, patientName: string, egn: string, dateOfBirth: string,
): string { return ''; }`;
  const sig = exportedSignatures(src)[0];
  assert.equal(sig.fn, 'buildSheetHeader');
  assert.ok(sig.params.some(isPatientIdentity), sig.params.join(','));
});

test('RED: the shipped generic the reader was already losing is now read', () => {
  // Not a fixture — the real file. The old pattern silently dropped
  // `setEchoPath<T>`, so the sweep was narrower than the file set it claimed,
  // and the vacuity guard could not tell (it only counted >= 5 signatures).
  const sigs = exportedSignatures(read('lib/echo-template.ts')).map((x) => x.fn);
  assert.ok(sigs.includes('setEchoPath'),
    `generic exports are still invisible; read: ${sigs.join(', ')}`);
});

test('RED: an arrow-function builder is read', () => {
  const src =
    `export const buildIdBlockHtml = (patientName: string, egn: string): string => '';`;
  const sig = exportedSignatures(src)[0];
  assert.equal(sig.fn, 'buildIdBlockHtml');
  assert.ok(sig.params.some(isPatientIdentity));
});

test('RED: a function with no return-type annotation is read, and attributed right', () => {
  // The old pattern required `): `, and its non-greedy body ran on to the NEXT
  // function's — so params were reported under the wrong function's name.
  const src = `
export function buildWhoLine(patientName?: string) { return ''; }
export function generatePdfHtml(f: TranscribeFields, dateStr: string): string { return ''; }`;
  const sigs = exportedSignatures(src);
  const who = sigs.find((x) => x.fn === 'buildWhoLine');
  const pdf = sigs.find((x) => x.fn === 'generatePdfHtml');
  assert.ok(who && who.params.includes('patientName'), 'the params landed on the wrong function');
  assert.ok(pdf && !pdf.params.some(isPatientIdentity), 'and bled into its neighbour');
  assert.deepEqual(pdf!.params, ['f', 'dateStr']);
});

test('RED: transliterated Bulgarian and reversed word order are caught', () => {
  for (const n of [
    'pacient', 'pacientImena', 'imeNaPacienta', 'egnPacient', 'dataNaRazhdane',
    'rozhdenaData', 'adresPacient', 'lichnaKarta', 'nameOfPatient', 'patientsName',
  ]) {
    assert.ok(isPatientIdentity(n), `not caught: ${n}`);
  }
  // …and the transliterated field names the лист legitimately carries are not.
  for (const n of ['osnovna_diagnoza', 'pridruzhavashti', 'napravlenia', 'naznacheni',
                   'izsledvania', 'obektivno', 'anamneza', 'terapia', 'zaklyuchenie']) {
    assert.equal(isPatientIdentity(n), false, `false positive: ${n}`);
  }
});

test('RED: a builder reached only through the @/ alias is in the graph', () => {
  // A whole new identity-taking builder in lib/handout-doc.ts, imported by the
  // modal as `@/lib/handout-doc`, was outside the walk entirely: it followed
  // only specifiers starting with `.`.
  const modal = read('components/PatientSummaryModal.tsx');
  assert.ok(/@\/lib\//.test(modal), 'the modal no longer uses the alias this test is about');
  // The walk resolves the alias, so a file imported that way is reachable.
  const fromModal = importGraph('components/PatientSummaryModal.tsx');
  assert.ok(fromModal.includes('lib/patient-summary-doc.ts'),
    `the @/ alias is still unresolved: ${fromModal.join(', ')}`);
  assert.ok(fromModal.includes('lib/exporters.ts'),
    'and it does not reach transitively through the aliased file');
});

test('RED: a spread on the modal element is refused', () => {
  const spread = `<PatientSummaryModal isOpen={o} visitDateBg={d} {...{ patientName: n }} />`;
  const tag = /<PatientSummaryModal([\s\S]*?)\/>/.exec(spread)!;
  assert.ok(/\{\s*\.\.\./.test(tag[1]), 'the spread must be detectable at all');
  // …and the shipped call site has none.
  const page = read('app/app/scribe/result/page.tsx');
  const shipped = [...page.matchAll(/<PatientSummaryModal([\s\S]*?)\/>/g)];
  assert.equal(shipped.length, 1);
  assert.ok(!/\{\s*\.\.\./.test(shipped[0][1]));
});
