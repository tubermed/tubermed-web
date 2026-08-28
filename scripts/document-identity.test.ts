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
  // ascii-safe: a TS function declaration in our own source
  const re = /export\s+function\s+([A-Za-z0-9_$]+)\s*\(([\s\S]*?)\)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const params = m[2]
      .split(/,(?![^<(]*[>)])/)          // top-level commas only
      .map((p) => p.trim())
      .filter(Boolean)
      // ascii-safe: a TS parameter name
      .map((p) => (/^([A-Za-z0-9_$]+)\s*\??\s*:?/.exec(p)?.[1] ?? p));
    out.push({ fn: m[1], params });
  }
  return out;
}

/** Field names of every `interface X { … }` in `src`. A builder that takes an
 *  options OBJECT hides its parameters from the signature reader above, so the
 *  fields are read too. */
function interfaceFields(src: string): Array<{ iface: string; field: string }> {
  const out: Array<{ iface: string; field: string }> = [];
  // ascii-safe: a TS interface declaration in our own source
  const re = /(?:export\s+)?interface\s+([A-Za-z0-9_$]+)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // Split on `;` as well as on newlines. Splitting on newlines alone reads
    // only the FIRST field of a single-line interface — which is how the red
    // proof below, `{ dateBg: string; patientEgn?: string }`, went green on its
    // own mutation the first time this file ran.
    for (const line of m[2].split(/[;\n]/)) {
      // ascii-safe: a TS interface member name
      const f = /^\s*(?:readonly\s+)?([A-Za-z0-9_$]+)\s*\??\s*:/.exec(line);
      if (f) out.push({ iface: m[1], field: f[1] });
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
    // ascii-safe: an ES import specifier
    const re = /(?:from|import)\s*['"](\.[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const base = norm(dirname(rel) + '/' + m[1]);
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
  // ascii-safe: a JSX attribute name in our own source
  const props = [...page.matchAll(/<PatientSummaryModal([\s\S]*?)\/>/g)]
    .flatMap((m) => [...m[1].matchAll(/([A-Za-z0-9_$]+)\s*=/g)].map((a) => a[1]));
  assert.ok(props.length > 0, 'the modal is no longer rendered where this gate can read its props');
  const bad = props.filter(isPatientIdentity);
  assert.deepEqual(bad, [], `the page passes an identity prop into the printed sheet: ${bad}`);
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
