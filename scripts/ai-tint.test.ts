// scripts/ai-tint.test.ts — the AI-provenance tint is a SCREEN affordance only
//
// The blue tint on an unedited, model-written section (2026-08-21) must
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

// Everything outside the print block — the rules a screen actually applies.
const screenOnly = (css: string): string => {
  const i = css.lastIndexOf('@media print {');
  if (i === -1) return css;
  return css.slice(0, i) + css.slice(css.indexOf('\n}\n', i) + 3);
};

// Every `inset:` on a `.ai-authored::after` rule, base and responsive alike,
// as its side list. The print block's selector is `.ai-authored::after,` — a
// comma, not a brace — so it is not matched here.
const afterInsets = (css: string): string[][] =>
  [...css.matchAll(/\.ai-authored::after\s*\{([^}]*)\}/g)]
    .map((m) => m[1].match(/inset:\s*([^;]+);/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => m[1].trim().split(/\s+/));

// ── Predicates (pure; section 3 feeds them broken input) ────────────────────
const P = {
  /** Inside @media print, BOTH pseudo-elements are display:none. Checked per
   *  pseudo, not per rule, so splitting or merging the selectors cannot pass
   *  one while losing the other. ::before draws nothing today (the corner dot
   *  was removed 2026-08-22); it stays in the neutraliser so that whatever
   *  treatment review lands on cannot reach paper just by being added. */
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
   *  with the tint token. */
  tintDefinedOnScreen(css: string): boolean {
    return /(^|\n)\.ai-authored::after\s*\{[^}]*background:\s*var\(--color-ai-tint\)/
      .test(screenOnly(css));
  },
  /** THE MARK IS THE SURFACE — no ::before is DRAWN on screen. The retired dot
   *  was absolutely positioned to the host's top-right corner, and every host
   *  already spends that corner on a control (Копирай, „няма ясен източник",
   *  the meds count badge); it overlapped them at some widths and not others,
   *  because it was pinned to the border box while they sit in a flex-wrap row.
   *  Any corner-absolute mark reintroduced there brings the whole class back,
   *  so this predicate refuses one rather than trusting a review to catch it. */
  markIsSurfaceOnly(css: string): boolean {
    const rules = screenOnly(css).replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^{}]*\}/g) || [];
    return !rules.some((r) => {
      const [sel, body] = r.split('{');
      return sel.split(',').some((s) => s.trim().startsWith('.ai-authored::before'))
        && /content:\s*(''|"")/.test(body);
    });
  },
  /** The surface extends PAST the host box on every side, AT EVERY WIDTH, and
   *  the host itself carries no padding — breathing room without layout shift,
   *  so clearing the class on edit moves nothing under the caret. Base rule and
   *  the ≥640px step are both checked and both required: a bleed that went
   *  flush or positive at one width only would press the tint edge onto the
   *  text there and nowhere else, which is a defect exactly one viewport sees. */
  surfaceHasOwnSpacing(css: string): boolean {
    const insets = afterInsets(css);
    // Two rules by construction — the sheet's padding steps at Tailwind's `sm`
    // and the bleed steps with it. One rule means the responsive step was lost.
    if (insets.length < 2) return false;
    // ascii-safe: CSS lengths, digits only
    const negative = (sides: string[]) =>
      sides.length >= 1 && sides.length <= 4 && sides.every((v) => /^-[0-9]+px$/.test(v));
    if (!insets.every(negative)) return false;
    const host = css.match(/(^|\n)\.ai-authored\s*\{([^}]*)\}/);
    return !!host && !/padding/.test(host[2]) && /isolation:\s*isolate/.test(host[2]);
  },
  /** The vertical bleed cannot close the seam between two adjacent tinted
   *  sections. Резултати и Назначени sit 16px apart on a real note, and two
   *  facing surfaces each eat their own top/bottom bleed — at 8px a side they
   *  meet, and the per-section mark becomes one undifferentiated blob that says
   *  „all of this is the machine's" where the truth is per-section. */
  verticalBleedKeepsTheSeam(css: string, minGapPx = 16): boolean {
    const insets = afterInsets(css);
    if (insets.length === 0) return false;
    // ascii-safe: digits only, sign already required by surfaceHasOwnSpacing
    const px = (v: string) => Number(v.replace(/[^0-9]/g, ''));
    return insets.every((sides) => {
      const top = px(sides[0]);
      const bottom = sides.length >= 3 ? px(sides[2]) : top;
      return top + bottom < minGapPx;
    });
  },
  /** The surface is an overlay ABOVE the content (multiply, z-index ≥ 0), not a
   *  layer behind it: two hosts wrap an opaque card, which would cover a
   *  surface painted underneath and leave a halo no source predicate can see. */
  surfaceIsOverlay(css: string): boolean {
    const m = css.match(/(^|\n)\.ai-authored::after\s*\{([^}]*)\}/);
    if (!m) return false;
    const z = m[2].match(/z-index:\s*(-?[0-9]+)/); // ascii-safe: an integer
    return !!z && Number(z[1]) >= 0
      && /mix-blend-mode:\s*multiply/.test(m[2])
      && /pointer-events:\s*none/.test(m[2]);
  },
  /** The tint token is named, not borrowed from brand/gold — and the retired
   *  dot token is gone from the sheet entirely, so nothing can quietly paint
   *  with it again. */
  tintHasOwnTokens(css: string): boolean {
    return /--color-ai-tint:\s*#[0-9A-Fa-f]{6}/.test(css) && !/--color-ai-dot/.test(css);
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
  assert.ok(P.tintHasOwnTokens(CSS), '--color-ai-tint must be a named token, and --color-ai-dot must be gone');
  assert.ok(P.tintDefinedOnScreen(CSS), '.ai-authored::after surface must exist outside @media print');
  assert.ok(P.markIsSurfaceOnly(CSS), 'the mark is the surface: no corner-absolute ::before may be drawn on screen');
  assert.ok(P.tintNeutralisedInPrint(CSS), 'Ctrl+P prints the live note: both pseudo-elements must be removed inside @media print');
  assert.ok(P.surfaceHasOwnSpacing(CSS), 'the surface must extend past the host (negative inset) at every width, with no host padding');
  assert.ok(P.verticalBleedKeepsTheSeam(CSS), 'the vertical bleed must leave a seam between two sections 16px apart');
  assert.ok(P.surfaceIsOverlay(CSS), 'the surface must be a multiply overlay above the content, never z-index:-1 behind an opaque card');
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
  assert.equal(P.tintDefinedOnScreen(CSS.replace('background: var(--color-ai-tint);', 'background: var(--color-brand-light);')), false);
  // The regression this change exists to prevent: the corner dot, put back.
  const RESPONSIVE_STEP = '@media (min-width: 640px) {\n  .ai-authored::after {';
  assert.ok(CSS.includes(RESPONSIVE_STEP), 'responsive bleed drifted — re-anchor the red proof');
  const WITH_DOT = CSS.replace(
    RESPONSIVE_STEP,
    ".ai-authored::before {\n  content: '';\n  position: absolute;\n  top: -1px;\n  right: -5px;\n  width: 8px;\n  height: 8px;\n}\n" + RESPONSIVE_STEP,
  );
  assert.notEqual(WITH_DOT, CSS, 'failed to reintroduce the dot — the red proof would be vacuous');
  assert.equal(P.markIsSurfaceOnly(WITH_DOT), false);
  // …and nothing else catches it: the print neutraliser still passes on that
  // same input. A dot hidden on paper is still a dot on screen, which is the
  // only place it ever collided — so this predicate is the one doing the work.
  assert.equal(P.tintNeutralisedInPrint(WITH_DOT), true);
  // Spacing: a flush surface, a one-sided bleed, a host with padding, no
  // stacking context, and — the width-specific shape — a responsive step that
  // goes positive while the base rule stays correct.
  assert.equal(P.surfaceHasOwnSpacing(CSS.replace('inset: -6px -12px;', 'inset: 0;')), false);
  assert.equal(P.surfaceHasOwnSpacing(CSS.replace('inset: -6px -12px;', 'inset: -6px 0;')), false);
  assert.equal(P.surfaceHasOwnSpacing(CSS.replace('inset: -6px -20px;', 'inset: -6px 20px;')), false);
  const RESPONSIVE_RULE = RESPONSIVE_STEP + '\n    inset: -6px -20px;\n  }\n}';
  assert.ok(CSS.includes(RESPONSIVE_RULE), 'responsive rule body drifted — re-anchor the red proof');
  assert.equal(P.surfaceHasOwnSpacing(CSS.replace(RESPONSIVE_RULE, '')), false);
  assert.equal(P.surfaceHasOwnSpacing(CSS.replace('isolation: isolate;', 'isolation: isolate;\n  padding: 8px 14px;')), false);
  assert.equal(P.surfaceHasOwnSpacing(CSS.replace('isolation: isolate;', 'isolation: auto;')), false);
  // The seam: 8px a side exactly closes a 16px gap, so it must already fail.
  assert.equal(P.verticalBleedKeepsTheSeam(CSS.replace('inset: -6px -12px;', 'inset: -8px -12px;')), false);
  assert.equal(P.verticalBleedKeepsTheSeam(CSS.replace('inset: -6px -20px;', 'inset: -10px -20px;')), false);
  // The threshold is load-bearing, not decoration: 6px a side clears the real
  // 16px gap with 4px to spare, exactly closes a 12px one, and is refused there.
  assert.equal(P.verticalBleedKeepsTheSeam(CSS, 13), true);
  assert.equal(P.verticalBleedKeepsTheSeam(CSS, 12), false);
  // Overlay: the occluded shape (behind the content), a normal-blend one (washes the text), a click-eating one.
  const OVERLAY = 'z-index: 1;\n  mix-blend-mode: multiply;';
  assert.ok(CSS.includes(OVERLAY), 'overlay declarations drifted — re-anchor the red proof');
  assert.equal(P.surfaceIsOverlay(CSS.replace(OVERLAY, 'z-index: -1;\n  mix-blend-mode: multiply;')), false);
  assert.equal(P.surfaceIsOverlay(CSS.replace(OVERLAY, 'z-index: 1;\n  mix-blend-mode: normal;')), false);
  // A click-eating surface: `pointer-events: none` dropped from the base
  // ::after rule (spliced out of that rule alone — a whole-file string replace
  // would hit whichever rule happens to come first and prove nothing).
  const BASE = CSS.match(/(^|\n)\.ai-authored::after\s*\{[^}]*\}/)?.[0];
  assert.ok(BASE && /pointer-events:\s*none/.test(BASE), 'base ::after rule drifted — re-anchor the red proof');
  assert.equal(P.surfaceIsOverlay(CSS.replace(BASE!, BASE!.replace(/\n\s*pointer-events:\s*none;/, ''))), false);
  assert.equal(P.tintHasOwnTokens(CSS.replace('--color-ai-tint:', '--color-ai-tint-x:')), false);
  assert.equal(P.tintHasOwnTokens(CSS.replace('  --color-ai-tint: #EEF4FB;', '  --color-ai-tint: #EEF4FB;\n  --color-ai-dot:  #2F5C8F;')), false);
  assert.equal(P.exportersBlindToTint(EXPORTERS + "\nconst leak = document.querySelector('.ai-authored');"), false);
  assert.equal(P.exportersBlindToTint(EXPORTERS + '\n// fields_touched mentioned only here\nconst x = fields_touched;'), false);
  assert.equal(P.editNeverPostsTouched(API.replace('chars_changed: charsChanged', 'chars_changed: charsChanged, fields_touched: touched')), false);
  assert.equal(P.everyKeyHosted(RESULT.replace("aiAuthored('terapia')", "aiAuthored('terapia_')"), TINT_KEYS), false);
  assert.equal(P.hostCarriesNoText(RESULT.replace('data-ai-authored={aiAuthored || undefined}>', 'data-ai-authored={aiAuthored || undefined} title="AI">')), false);
  assert.equal(P.typeIsSibling(TYPES.replace('export interface TranscribeFields {', 'export interface TranscribeFields {\n  fields_touched?: FieldsTouched;')), false);
});
