// scripts/ai-tint.test.ts — the AI-provenance tint is a SCREEN affordance only
//
// The blue tint + dot on an unedited, model-written section (2026-08-21) must
// never reach copy, export or print. Two of those three are structurally
// immune — lib/exporters.ts builds PDF / Word / clipboard text from the
// `fields` DATA and never reads the DOM — and the third, Ctrl+P of the live
// result page, is a stylesheet rule. Neither fact is observable by a DOM-free
// `node --test`, so this is a SOURCE-TEXT gate in the print-and-phone pattern:
// pure predicates over the real files, then (section 3) each predicate fed the
// shape it exists to reject, so a green here is not decorative.
//
// It also pins the contract edges: `fields_touched` is never posted back
// (it would corrupt the comparison it is derived from), every tint key has a
// host on the page, and the tint host never carries text (no sr-only label,
// no title) — a visual-only affordance by decision.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const CSS       = read('app/globals.css');
const RESULT    = read('app/app/scribe/result/page.tsx');
const EXPORTERS = read('lib/exporters.ts');
const API       = read('lib/api.ts');
const TYPES     = read('lib/types.ts');

const TINT_KEYS = [
  'anamneza', 'obektivno', 'izsledvania', 'terapia', 'napravlenia', 'naznacheni',
  'osnovna_diagnoza', 'osnovna_mkb', 'alergii', 'medications_list', 'pridruzhavashti',
];

// ── Predicates (pure; section 3 feeds them broken input) ────────────────────
const P = {
  /** Inside @media print, BOTH pseudo-elements — the ::after surface and the
   *  ::before dot — are display:none. Checked per pseudo, not per rule, so
   *  splitting or merging the selectors cannot pass one while losing the other. */
  tintNeutralisedInPrint(css: string): boolean {
    const i = css.lastIndexOf('@media print {');
    if (i === -1) return false;
    const block = css.slice(i, css.indexOf('\n}\n', i) + 3);
    const rules = block.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^{}]*\}/g) || [];
    const hidden = (pseudo: string) => rules.some((r) => {
      const [sel, body] = r.split('{');
      return sel.split(',').some((s) => s.trim() === `.ai-authored::${pseudo}`)
        && /display:\s*none\s*!important/.test(body);
    });
    return hidden('after') && hidden('before');
  },
  /** The screen rule exists outside @media print: a ::after surface painted
   *  with the tint token, and a ::before dot. */
  tintDefinedOnScreen(css: string): boolean {
    const printStart = css.lastIndexOf('@media print {');
    const screen = css.slice(0, printStart) + css.slice(css.indexOf('\n}\n', printStart) + 3);
    return /(^|\n)\.ai-authored::after\s*\{[^}]*background:\s*var\(--color-ai-tint\)/.test(screen)
      && /(^|\n)\.ai-authored::before\s*\{[^}]*content:\s*''/.test(screen);
  },
  /** The surface extends PAST the host box (negative inset on every side) and
   *  the host itself carries no padding — breathing room without layout shift,
   *  so clearing the class on edit moves nothing under the caret. */
  surfaceHasOwnSpacing(css: string): boolean {
    const m = css.match(/(^|\n)\.ai-authored::after\s*\{([^}]*)\}/);
    if (!m) return false;
    const inset = m[2].match(/inset:\s*([^;]+);/);
    if (!inset) return false;
    const sides = inset[1].trim().split(/\s+/);
    if (sides.length < 1 || sides.length > 4 || !sides.every((v) => /^-\d+px$/.test(v))) return false;
    const host = css.match(/(^|\n)\.ai-authored\s*\{([^}]*)\}/);
    return !!host && !/padding/.test(host[2]) && /isolation:\s*isolate/.test(host[2]);
  },
  /** The tint tokens are named, not borrowed from brand/gold. */
  tintHasOwnTokens(css: string): boolean {
    return /--color-ai-tint:\s*#[0-9A-Fa-f]{6}/.test(css) && /--color-ai-dot:\s*#[0-9A-Fa-f]{6}/.test(css);
  },
  /** Exporters never reference the tint and never read the DOM for content. */
  exportersBlindToTint(src: string): boolean {
    if (/ai-authored|fields_touched|aiAuthored|FieldsTouched/.test(src)) return false;
    return !/innerText|cloneNode|querySelector|getElementById\(/.test(src.replace(/\/\/.*$/gm, ''));
  },
  /** The edit request body is { field, fields, chars_changed } — no provenance key. */
  editNeverPostsTouched(api: string): boolean {
    const i = api.indexOf('editConsultation');
    const body = api.slice(i, api.indexOf('}),', i));
    return body.length > 0 && !/fields_touched|FieldsTouched/.test(body);
  },
  /** Every tint key has a host on the result page. */
  everyKeyHosted(page: string, keys: string[]): boolean {
    return keys.every((k) => new RegExp(`aiAuthored\\([^)]*'${k}'`).test(page));
  },
  /** The host is decorative: class + data attribute only, no text or title. */
  hostCarriesNoText(page: string): boolean {
    const hosts = page.match(/data-ai-authored=\{[^}]*\}[^>]*>/g) || [];
    if (hosts.length === 0) return false;
    return hosts.every((h) => !/title=|aria-label=|sr-only/.test(h));
  },
  /** FieldsTouched is declared read-only and outside TranscribeFields. */
  typeIsSibling(types: string): boolean {
    const tf = types.slice(types.indexOf('export interface TranscribeFields'), types.indexOf('\n}\n', types.indexOf('export interface TranscribeFields')));
    return /export type FieldsTouched = Record<string, boolean>/.test(types) && !/fields_touched/.test(tf);
  },
};

// ── 1. The stylesheet ───────────────────────────────────────────────────────
test('the tint is defined on screen with its own tokens and neutralised in @media print', () => {
  assert.ok(P.tintHasOwnTokens(CSS), '--color-ai-tint / --color-ai-dot must be named tokens');
  assert.ok(P.tintDefinedOnScreen(CSS), '.ai-authored::after surface + ::before dot must exist outside @media print');
  assert.ok(P.tintNeutralisedInPrint(CSS), 'Ctrl+P prints the live note: the surface and the dot must be removed inside @media print');
  assert.ok(P.surfaceHasOwnSpacing(CSS), 'the surface must extend past the host (negative inset) with no host padding');
});

// ── 2. Copy / export / the page ─────────────────────────────────────────────
test('copy, PDF and Word are built from data — the exporters cannot see the tint', () => {
  assert.ok(P.exportersBlindToTint(EXPORTERS));
});
test('fields_touched is read-only: never posted on /edit, a sibling of the note, not a note key', () => {
  assert.ok(P.editNeverPostsTouched(API));
  assert.ok(P.typeIsSibling(TYPES));
});
test('every doctor-editable key has a tint host, and the host carries no text', () => {
  assert.ok(P.everyKeyHosted(RESULT, TINT_KEYS), 'a key without aiAuthored(...) wiring would silently never tint');
  assert.ok(P.hostCarriesNoText(RESULT));
  // Embedded investigation blocks (model-written readouts) get a per-block host.
  assert.match(RESULT, /data-ai-authored={aiAuthoredBlock(i) || undefined}/, 'each izsledvania_blocks card must be a tint host');
  // Editing is the attestation: the optimistic clear must live in trackEdit.
  const i = RESULT.indexOf('const trackEdit = useCallback');
  assert.match(RESULT.slice(i, i + 1200), /setLocalTouched/);
});

// ── 3. Red proof ────────────────────────────────────────────────────────────
test('RED PROOF — every predicate rejects the regression it guards', () => {
  const NO_PRINT_RULE = CSS.replace(/\n  \/\* The AI-authored tint[\s\S]*?\.ai-authored::before \{\n    display: none !important;\n  \}\n/, '\n');
  assert.notEqual(NO_PRINT_RULE, CSS, 'failed to remove the print rule — the red proof would be vacuous');
  assert.equal(P.tintNeutralisedInPrint(NO_PRINT_RULE), false);
  // Lose ONE pseudo from the print selector list: the other surviving is not enough.
  const PRINT_SEL = '  .ai-authored::after,\n  .ai-authored::before {\n    display: none !important;';
  assert.ok(CSS.includes(PRINT_SEL), 'print selector list drifted — re-anchor the red proof');
  assert.equal(P.tintNeutralisedInPrint(CSS.replace(PRINT_SEL, '  .ai-authored::before {\n    display: none !important;')), false);
  assert.equal(P.tintNeutralisedInPrint(CSS.replace(PRINT_SEL, '  .ai-authored::after {\n    display: none !important;')), false);
  assert.equal(P.tintNeutralisedInPrint(CSS.replace(PRINT_SEL, PRINT_SEL.replace('none', 'block'))), false);
  const NO_DOT = CSS.replace(".ai-authored::before {\n  content: '';", '.ai-authored::before {\n  content: none;');
  assert.notEqual(NO_DOT, CSS, 'dot rule drifted — re-anchor the red proof');
  assert.equal(P.tintDefinedOnScreen(NO_DOT), false);
  assert.equal(P.tintDefinedOnScreen(CSS.replace('background: var(--color-ai-tint);', 'background: var(--color-brand-light);')), false);
  // Spacing: a flush surface, a host with padding, or no stacking context all fail.
  assert.equal(P.surfaceHasOwnSpacing(CSS.replace('inset: -8px -14px -6px;', 'inset: 0;')), false);
  assert.equal(P.surfaceHasOwnSpacing(CSS.replace('inset: -8px -14px -6px;', 'inset: -8px 0 -6px;')), false);
  assert.equal(P.surfaceHasOwnSpacing(CSS.replace('isolation: isolate;', 'isolation: isolate;\n  padding: 8px 14px;')), false);
  assert.equal(P.surfaceHasOwnSpacing(CSS.replace('isolation: isolate;', 'isolation: auto;')), false);
  assert.equal(P.tintHasOwnTokens(CSS.replace('--color-ai-tint:', '--color-ai-tint-x:')), false);
  assert.equal(P.exportersBlindToTint(EXPORTERS + "\nconst leak = document.querySelector('.ai-authored');"), false);
  assert.equal(P.exportersBlindToTint(EXPORTERS + '\n// fields_touched mentioned only here\nconst x = fields_touched;'), false);
  assert.equal(P.editNeverPostsTouched(API.replace('chars_changed: charsChanged', 'chars_changed: charsChanged, fields_touched: touched')), false);
  assert.equal(P.everyKeyHosted(RESULT.replace("aiAuthored('terapia')", "aiAuthored('terapia_')"), TINT_KEYS), false);
  assert.equal(P.hostCarriesNoText(RESULT.replace('data-ai-authored={aiAuthored || undefined}>', 'data-ai-authored={aiAuthored || undefined} title="AI">')), false);
  assert.equal(P.typeIsSibling(TYPES.replace('export interface TranscribeFields {', 'export interface TranscribeFields {\n  fields_touched?: FieldsTouched;')), false);
});
