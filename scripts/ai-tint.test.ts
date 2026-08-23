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
//
// Since 2026-08-23 the mark has TWO layers and this gate pins both: the tint
// surface (::after, soft, secondary) and the CARRIER — a dashed left edge
// (::before) along the surface's left boundary, which is what a doctor can
// actually see (the tint alone measured ~1.07:1 against white). The carrier
// must be a LEFT EDGE, never a corner-absolute mark: every host's top-right
// corner is a control slot, and the retired dot collided with all of them.

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

// The body of the FIRST at-rule block opening with `head`, by brace matching —
// so a rule that follows the block can never stand in for one inside it.
const mediaBlock = (css: string, head: string): string => {
  const start = css.indexOf(head);
  if (start === -1) return '';
  let depth = 0;
  for (let i = start + head.length - 1; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start + head.length, i);
  }
  return '';
};

// WCAG 2.x contrast ratio of two 6-digit hexes (sRGB relative luminance).
const contrast = (a: string, b: string): number => {
  const lum = (h: string) => {
    const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) // ascii-safe: hex digits
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

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
  /** THE CARRIER IS A LEFT EDGE. The base screen `.ai-authored::before` rule
   *  must draw a vertical edge along the surface's LEFT boundary: anchored by
   *  `left` (negative — outside the host box, at the bleed), spanning `top` to
   *  `bottom` (the surface's height, never a fixed `height`), painted with
   *  `border-left … var(--color-ai-edge)`, above the multiply overlay (a
   *  z-index greater than ::after's, so the edge is crisp and not washed by
   *  the tint), and click-transparent.
   *
   *  What it refuses, by shape: the retired corner dot (`right` + `width` +
   *  `height`), or any mark that declares `right` at all. Every host's
   *  top-right corner is a control slot (Копирай, „няма ясен източник", the
   *  meds count badge) and the dot collided with all of them, at different
   *  widths, because it was pinned to the border box while the controls sit
   *  in a flex-wrap row. A corner mark brings the whole class back, so this
   *  predicate refuses one rather than trusting a review to catch it. */
  markIsLeftEdge(css: string): boolean {
    const clean = screenOnly(css).replace(/\/\*[\s\S]*?\*\//g, '');
    const before = clean.match(/(^|\n)\.ai-authored::before\s*\{([^}]*)\}/);
    const after = clean.match(/(^|\n)\.ai-authored::after\s*\{([^}]*)\}/);
    if (!before || !after) return false;
    const b = before[2];
    // Declarations are matched at a property boundary (`;`, `{` or line start)
    // so `border-left` can never satisfy or violate a check meant for `left`.
    const decl = (prop: string) => new RegExp(`(^|[;{\\n])\\s*${prop}:\\s*([^;]+);`).exec(b)?.[2].trim();
    const z = (body: string) => Number(/z-index:\s*(-?[0-9]+)/.exec(body)?.[1] ?? NaN); // ascii-safe: an integer
    const left = decl('left');
    const width = decl('width');
    return /content:\s*(''|"")/.test(b)
      && decl('position') === 'absolute'
      && !!left && /^-[0-9]+px$/.test(left)                               // ascii-safe: a CSS length
      && decl('right') === undefined
      && decl('height') === undefined
      && (width === undefined || width === '0')
      && /^-?[0-9]+px$/.test(decl('top') ?? '') && /^-?[0-9]+px$/.test(decl('bottom') ?? '') // ascii-safe: CSS lengths
      && /^[1-9][0-9]*px\s+(dashed|dotted|solid)\s+var\(--color-ai-edge\)$/.test(decl('border-left') ?? '') // ascii-safe: a CSS border shorthand
      && decl('pointer-events') === 'none'
      && z(b) > z(after[2]);
  },
  /** The edge sits ON the surface's left boundary at every width: each screen
   *  `.ai-authored::before` rule's `left` equals the horizontal inset of the
   *  `.ai-authored::after` rule beside it — base, the ≥640px step, and the
   *  aside override alike, in sheet order. A surface that steps its bleed
   *  without the edge stepping with it leaves the edge floating inside the
   *  tint at one width and outside it at another — a mark whose position
   *  depends on the window, which is the defect the dot was removed for. */
  edgeTracksSurface(css: string): boolean {
    const clean = screenOnly(css).replace(/\/\*[\s\S]*?\*\//g, '');
    const surfaceX = [...clean.matchAll(/\.ai-authored::after\s*\{([^}]*)\}/g)]
      .map((m) => /inset:\s*([^;]+);/.exec(m[1])?.[1].trim().split(/\s+/))
      .map((sides) => (sides ? (sides.length >= 2 ? sides[1] : sides[0]) : null));
    const edgeX = [...clean.matchAll(/\.ai-authored::before\s*\{([^}]*)\}/g)]
      .map((m) => /(^|[;{\n])\s*left:\s*([^;]+);/.exec(m[1])?.[2].trim() ?? null);
    return surfaceX.length >= 2 && surfaceX.length === edgeX.length
      && surfaceX.every((x, i) => x !== null && x === edgeX[i]);
  },
  /** The surface extends PAST the host box on every side, AT EVERY WIDTH, and
   *  the host itself carries no padding — breathing room without layout shift,
   *  so clearing the class on edit moves nothing under the caret. Base rule and
   *  the ≥640px step are both checked and both required: a bleed that went
   *  flush or positive at one width only would press the tint edge onto the
   *  text there and nowhere else, which is a defect exactly one viewport sees. */
  surfaceHasOwnSpacing(css: string): boolean {
    const insets = afterInsets(css);
    // The sheet's padding steps at Tailwind's `sm` and the bleed steps with it:
    // a ::after inset INSIDE the min-width:640px block is required by name (a
    // rule count would be satisfied by the aside override alone, 2026-08-23).
    if (insets.length < 2) return false;
    if (!/\.ai-authored::after\s*\{[^}]*inset:/.test(mediaBlock(css, '@media (min-width: 640px) {'))) return false;
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
  /** The carrier is VISIBLE, not merely shaped (the fresh-context refuter's
   *  find, 2026-08-23: an edge recoloured to the tint, or hidden with
   *  display/visibility/opacity, passed every shape check). Two halves:
   *  no screen rule on `.ai-authored::before` — base, step or override —
   *  may hide it; and the edge token must measure at least 3:1 (WCAG's
   *  non-text minimum) against BOTH grounds it meets, the sheet and the tint.
   *  The ratio is computed from the token hexes — the same arithmetic the
   *  pixel measurement used (6.89:1 / 6.22:1 on 2026-08-23), so a retune of
   *  either token that drops the edge below legibility fails here, not at
   *  review. */
  edgeIsVisible(css: string): boolean {
    const clean = screenOnly(css).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...clean.matchAll(/\.ai-authored::before\s*\{([^}]*)\}/g)].map((m) => m[1]);
    // The BASE rule (line-anchored) must exist: the step and the override
    // alone draw nothing, they only reposition what the base rule draws.
    if (rules.length === 0 || !/(^|\n)\.ai-authored::before\s*\{/.test(clean)) return false;
    if (rules.some((b) => /(^|[;{\n])\s*(display|visibility|opacity|content:\s*none)/.test(b))) return false;
    const token = (name: string) => css.match(new RegExp(`${name}:\\s*#([0-9A-Fa-f]{6})`))?.[1];
    const edge = token('--color-ai-edge'), tint = token('--color-ai-tint'), sheet = token('--color-bg-surface');
    if (!edge || !tint || !sheet) return false;
    return contrast(edge, tint) >= 3 && contrast(edge, sheet) >= 3;
  },
  /** CLOSED FORM. A source-text gate cannot see the cascade: the refuter's
   *  second round (2026-08-23) wrote 34 mutations of this sheet and 28 of
   *  them left every predicate above green while the carrier rendered with
   *  0% ink in the real page — a trailing `.ai-authored:before { border: 0 }`,
   *  `border-left-color: transparent` or `clip-path` or `transform: scale(0)`
   *  ADDED to the base rule beside the declarations that are checked, a
   *  second `--color-ai-edge` in `:root`, `overflow: hidden` on the host.
   *  Every one is "something else in the sheet wins". So the sheet may say
   *  NOTHING about the carrier beyond what is pinned here:
   *    – the base rule carries exactly these nine declarations, each once;
   *    – the 640px step and the aside override carry exactly `left`;
   *    – the host rule carries exactly `position` + `isolation`;
   *    – no other selector addresses the pseudo-element in any spelling
   *      (`:before`, `::before`, inside `:is()`, an attribute form, a
   *      descendant form, inside `@media screen` / `@supports`);
   *    – `--color-ai-edge` is defined exactly once in the whole file.
   *  Values stay loose where review owns them (thickness, style, colour —
   *  the colour through edgeIsVisible); the SET of properties is closed.
   *  What this still cannot see: a utility class or inline style on a host
   *  or an ancestor — hostIsBare covers the host tag; the rendered check
   *  (the edge sweep in the rig) remains the only proof of pixels. */
  edgeRulesAreClosed(css: string): boolean {
    const clean = screenOnly(css).replace(/\/\*[\s\S]*?\*\//g, '');
    const decls = (body: string) => body.split(';').map((s) => s.trim()).filter(Boolean)
      .map((s) => { const i = s.indexOf(':'); return [s.slice(0, i).trim(), s.slice(i + 1).trim()] as const; });
    const exactly = (body: string | undefined, expected: Record<string, string | RegExp>): boolean => {
      if (body === undefined) return false;
      const d = decls(body);
      if (d.length !== Object.keys(expected).length) return false;
      const seen = new Set<string>();
      return d.every(([p, v]) => {
        if (seen.has(p)) return false;
        seen.add(p);
        const e = expected[p];
        return e !== undefined && (typeof e === 'string' ? v === e : e.test(v));
      });
    };
    const base = clean.match(/(^|\n)\.ai-authored::before\s*\{([^}]*)\}/)?.[2];
    const step = mediaBlock(clean, '@media (min-width: 640px) {').match(/\.ai-authored::before\s*\{([^}]*)\}/)?.[1];
    const aside = clean.match(/\n\.result-grid > aside \.ai-authored::before\s*\{([^}]*)\}/)?.[1];
    const host = clean.match(/(^|\n)\.ai-authored\s*\{([^}]*)\}/)?.[2];
    const px = /^-?[0-9]+px$/; // ascii-safe: CSS lengths
    if (!exactly(base, {
      content: /^(''|"")$/, position: 'absolute', top: px, bottom: px, left: /^-[0-9]+px$/, width: '0',
      'border-left': /^[1-9][0-9]*px (dashed|dotted|solid) var\(--color-ai-edge\)$/, // ascii-safe: a CSS border shorthand
      'z-index': /^[0-9]+$/, 'pointer-events': 'none',
    })) return false;
    if (!exactly(step, { left: /^-[0-9]+px$/ })) return false;
    if (!exactly(aside, { left: /^-[0-9]+px$/ })) return false;
    if (!exactly(host, { position: 'relative', isolation: 'isolate' })) return false;
    // Every selector in the screen sheet (at-rule heads excluded); exactly
    // the three known ones may mention the host together with `before`.
    const selectors = [...clean.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith('@'));
    if (selectors.filter((s) => /ai-authored/.test(s) && /before/.test(s)).length !== 3) return false;
    return (css.match(/--color-ai-edge\s*:/g) || []).length === 1;
  },
  /** The host tag itself is bare: id / key / className / data-ai-authored and
   *  nothing else — no inline style, no extra utility hook. (The class string
   *  is checked by hostClassesAreClosed.) */
  hostIsBare(page: string): boolean {
    const tags = page.match(/<div[\s\n][^>]*data-ai-authored=[^>]*>/g) || [];
    if (tags.length === 0) return false;
    return tags.every((t) => [...t.matchAll(/\s([A-Za-z][A-Za-z0-9-]*)=/g)].map((m) => m[1]) // ascii-safe: JSX attribute names
      .every((a) => ['id', 'key', 'className', 'data-ai-authored'].includes(a)));
  },
  /** Every class literal that carries `ai-authored` is made only of the
   *  layout tokens the hosts are known to use — a utility such as
   *  `overflow-hidden` or `contain-paint` on a host would clip the edge
   *  without touching the sheet. */
  hostClassesAreClosed(page: string): boolean {
    // Class-token characters only, so the match can never span from one
    // string literal to the next (`…'pridruzhavashti') ? 'ai-authored'`).
    const literals = page.match(/'[A-Za-z0-9 :/.\-\[\]]*ai-authored[A-Za-z0-9 :/.\-\[\]]*'/g) || []; // ascii-safe: Tailwind class tokens
    if (literals.length === 0) return false;
    const allowed = new Set(['ai-authored', 'scroll-mt-24', 'mb-4']);
    return literals.every((l) => l.slice(1, -1).split(/\s+/).every((c) => allowed.has(c)));
  },
  /** The tint and the edge are named tokens of the AI-authored family, not
   *  borrowed from brand/gold — and the retired dot token is gone from the
   *  sheet entirely, so nothing can quietly paint with it again. */
  tintHasOwnTokens(css: string): boolean {
    return /--color-ai-tint:\s*#[0-9A-Fa-f]{6}/.test(css)
      && /--color-ai-edge:\s*#[0-9A-Fa-f]{6}/.test(css)
      && !/--color-ai-dot/.test(css);
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
  assert.ok(P.tintHasOwnTokens(CSS), '--color-ai-tint and --color-ai-edge must be named tokens, and --color-ai-dot must be gone');
  assert.ok(P.tintDefinedOnScreen(CSS), '.ai-authored::after surface must exist outside @media print');
  assert.ok(P.markIsLeftEdge(CSS), 'the carrier is a dashed LEFT edge on ::before, above the overlay — never a corner-absolute mark');
  assert.ok(P.edgeTracksSurface(CSS), 'the edge must sit on the surface boundary at every width: each ::before left equals the ::after horizontal inset beside it');
  assert.ok(P.edgeIsVisible(CSS), 'the edge must be visible: never hidden by a screen rule, and at least 3:1 against both the sheet and the tint');
  assert.ok(P.edgeRulesAreClosed(CSS), 'the sheet may say nothing else about the carrier: closed declaration sets, no other selector on the pseudo-element, the token defined once');
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
  assert.ok(P.hostIsBare(RESULT), 'a tint host tag carries id / key / className / data-ai-authored and nothing else');
  assert.ok(P.hostClassesAreClosed(RESULT), 'a tint host class string is made only of ai-authored + its known layout tokens');
  // Embedded investigation blocks (model-written readouts) get a per-block host.
  assert.match(RESULT, /data-ai-authored={aiAuthoredBlock(i) || undefined}/, 'each izsledvania_blocks card must be a tint host');
  // Editing is the attestation: the optimistic clear must live in trackEdit.
  const i = RESULT.indexOf('const trackEdit = useCallback');
  assert.match(RESULT.slice(i, i + 1200), /setLocalTouched/);
});

// ── 3. Red proof ────────────────────────────────────────────────────────────
test('RED PROOF — every predicate rejects the regression it guards', () => {
  const NO_PRINT_RULE = CSS.replace(/\n  \/\* The AI-authored mark[\s\S]*?\.ai-authored::before \{\n    display: none !important;\n  \}\n/, '\n');
  assert.notEqual(NO_PRINT_RULE, CSS, 'failed to remove the print rule — the red proof would be vacuous');
  assert.equal(P.tintNeutralisedInPrint(NO_PRINT_RULE), false);
  // Lose ONE pseudo from the print selector list: the other surviving is not enough.
  const PRINT_SEL = '  .ai-authored::after,\n  .ai-authored::before {\n    display: none !important;';
  assert.ok(CSS.includes(PRINT_SEL), 'print selector list drifted — re-anchor the red proof');
  assert.equal(P.tintNeutralisedInPrint(CSS.replace(PRINT_SEL, '  .ai-authored::before {\n    display: none !important;')), false);
  assert.equal(P.tintNeutralisedInPrint(CSS.replace(PRINT_SEL, '  .ai-authored::after {\n    display: none !important;')), false);
  assert.equal(P.tintNeutralisedInPrint(CSS.replace(PRINT_SEL, PRINT_SEL.replace('none', 'block'))), false);
  assert.equal(P.tintDefinedOnScreen(CSS.replace('background: var(--color-ai-tint);', 'background: var(--color-brand-light);')), false);
  // THE CARRIER REMOVED: the base ::before rule deleted outright. This is the
  // regression the 2026-08-23 ruling exists to prevent — the tint alone is
  // ~1.07:1 against white and carries nothing a doctor can see.
  const EDGE_RULE = CSS.match(/(^|\n)\.ai-authored::before\s*\{[^}]*\}/)?.[0];
  assert.ok(EDGE_RULE && /border-left/.test(EDGE_RULE), 'base ::before edge rule drifted — re-anchor the red proof');
  const NO_EDGE = CSS.replace(EDGE_RULE!, '\n');
  assert.notEqual(NO_EDGE, CSS, 'failed to remove the edge — the red proof would be vacuous');
  assert.equal(P.markIsLeftEdge(NO_EDGE), false);
  // …and nothing else catches it: the surface predicates and the print
  // neutraliser all still pass on that same input, so this predicate is the
  // one doing the work.
  assert.equal(P.tintDefinedOnScreen(NO_EDGE), true);
  assert.equal(P.surfaceHasOwnSpacing(NO_EDGE), true);
  assert.equal(P.tintNeutralisedInPrint(NO_EDGE), true);
  // The corner dot, put back in the edge's place: `right` + `width` + `height`.
  const WITH_DOT = CSS.replace(EDGE_RULE!, "\n.ai-authored::before {\n  content: '';\n  position: absolute;\n  top: -1px;\n  right: -5px;\n  width: 8px;\n  height: 8px;\n  z-index: 2;\n  pointer-events: none;\n}");
  assert.equal(P.markIsLeftEdge(WITH_DOT), false);
  assert.equal(P.tintNeutralisedInPrint(WITH_DOT), true);
  // Each shape constraint alone, spliced into the base edge rule only (a
  // whole-file replace would hit the responsive step first and prove nothing).
  const edge = (from: string, to: string) => {
    const r = EDGE_RULE!.replace(from, to);
    assert.notEqual(r, EDGE_RULE, `edge splice "${from}" did not apply — re-anchor the red proof`);
    return CSS.replace(EDGE_RULE!, r);
  };
  assert.equal(P.markIsLeftEdge(edge('left: -12px;', 'right: -12px;')), false);         // the corner
  assert.equal(P.markIsLeftEdge(edge('left: -12px;', 'left: 0;')), false);              // flush with the text, not at the bleed
  assert.equal(P.markIsLeftEdge(edge('bottom: -6px;', 'height: 16px;')), false);        // a tick-length mark, indistinguishable from the section tick
  assert.equal(P.markIsLeftEdge(edge('var(--color-ai-edge)', 'var(--color-accent)')), false); // borrowed colour — drifts with the brand
  assert.equal(P.markIsLeftEdge(edge('z-index: 2;', 'z-index: 0;')), false);             // under the overlay: multiplied, washed
  assert.equal(P.markIsLeftEdge(edge('z-index: 2;', 'z-index: 1;')), false);             // level with it: paint order undefined by this sheet
  assert.equal(P.markIsLeftEdge(edge('  pointer-events: none;\n', '')), false);          // eats the click-to-edit
  // `border-left` must never satisfy a check meant for `left` (and vice versa).
  assert.equal(P.markIsLeftEdge(edge('  left: -12px;\n', '')), false);
  // Tracking: the responsive step lost, the step's edge left behind, the aside
  // override's edge left behind.
  const STEP_EDGE = '  .ai-authored::before {\n    left: -20px;\n  }\n';
  assert.ok(CSS.includes(STEP_EDGE), 'responsive edge step drifted — re-anchor the red proof');
  assert.equal(P.edgeTracksSurface(CSS.replace(STEP_EDGE, '')), false);
  assert.equal(P.edgeTracksSurface(CSS.replace(STEP_EDGE, STEP_EDGE.replace('-20px', '-12px'))), false);
  const ASIDE_EDGE = '.result-grid > aside .ai-authored::before {\n  left: -12px;\n}';
  assert.ok(CSS.includes(ASIDE_EDGE), 'aside edge override drifted — re-anchor the red proof');
  assert.equal(P.edgeTracksSurface(CSS.replace(ASIDE_EDGE, '')), false);
  assert.equal(P.edgeTracksSurface(CSS.replace(ASIDE_EDGE, ASIDE_EDGE.replace('-12px', '-20px'))), false);
  assert.equal(P.edgeTracksSurface(NO_EDGE), false);
  // Visibility (the refuter's three routes, plus the seam between them):
  // the edge recoloured to the tint; hidden in the base rule, the step or
  // the aside override; a token retune that lands below 3:1 on either ground.
  assert.equal(P.edgeIsVisible(NO_EDGE), false);
  assert.equal(P.edgeIsVisible(CSS.replace('--color-ai-edge: #2F5C8F;', '--color-ai-edge: #EEF4FB;')), false);
  assert.equal(P.edgeIsVisible(CSS.replace('--color-ai-edge: #2F5C8F;', '--color-ai-edge: #C2CAD4;')), false); // border-strong: 1.6:1 on white
  assert.equal(P.edgeIsVisible(CSS.replace('--color-ai-edge: #2F5C8F;', '--color-ai-edge: #8893A1;')), false); // text-hint: 3.1:1 on white, 2.7:1 on the tint
  assert.equal(P.edgeIsVisible(edge('  pointer-events: none;\n', '  pointer-events: none;\n  display: none;\n')), false);
  assert.equal(P.edgeIsVisible(edge('  pointer-events: none;\n', '  pointer-events: none;\n  opacity: 0;\n')), false);
  assert.equal(P.edgeIsVisible(CSS.replace(STEP_EDGE, '  .ai-authored::before {\n    left: -20px;\n    visibility: hidden;\n  }\n')), false);
  assert.equal(P.edgeIsVisible(CSS.replace(ASIDE_EDGE, '.result-grid > aside .ai-authored::before {\n  left: -12px;\n  display: none;\n}')), false);
  assert.equal(P.edgeIsVisible(CSS.replace('--color-ai-tint: #EEF4FB;', '--color-ai-tint: #2F5C8F;')), false); // the tint retuned onto the edge
  // …and the real sheet clears the bar with room: the token is 6.9:1 on
  // white and 6.2:1 on the tint, so a 3:1 floor is a floor, not a fit.
  assert.ok(contrast('2F5C8F', 'FFFFFF') > 6.5 && contrast('2F5C8F', 'EEF4FB') > 6);
  // CLOSED FORM — the refuter's 28 green-but-invisible mutations, one per
  // route class. Each was rendered in the real page at 0% ink before this
  // predicate existed; each must now be refused by the sheet alone.
  const closed = (mutated: string) => { assert.notEqual(mutated, CSS, 'mutation did not apply'); return P.edgeRulesAreClosed(mutated); };
  // A later rule wins the cascade, in every spelling the regexes above do not see.
  assert.equal(closed(CSS + '\n.ai-authored:before { border: 0; }\n'), false);
  assert.equal(closed(CSS + '\n.ai-authored::before, .never-matches { display: none; }\n'), false);
  assert.equal(closed(CSS + '\n[class~="ai-authored"]::before { border-left-width: 0; }\n'), false);
  assert.equal(closed(CSS + '\n:is(.ai-authored)::before { border-left-color: transparent; }\n'), false);
  assert.equal(closed(CSS + '\nhtml .ai-authored::before { left: -12px; border-left-color: transparent; }\n'), false);
  assert.equal(closed(CSS + '\n@media screen {\n  .ai-authored:before { visibility: hidden; }\n}\n'), false);
  // A declaration ADDED to the base rule beside the nine that are checked.
  for (const extra of ['border-left-color: transparent', 'clip-path: inset(100%)', 'transform: scale(0)', 'filter: opacity(0)',
    'mix-blend-mode: lighten', 'max-height: 0', 'border-left-style: hidden', 'inset-block: 50% 50%', 'scale: 0',
    'translate: -9999px', 'border-image: linear-gradient(transparent, transparent) 1', 'content: normal', 'border-left: 0']) {
    assert.equal(closed(edge('  pointer-events: none;\n', `  pointer-events: none;\n  ${extra};\n`)), false, extra);
  }
  assert.equal(closed(edge('  left: -12px;\n', '  left: -12px;\n  left: 9999px;\n')), false);          // the same property twice
  assert.equal(closed(edge('  width: 0;\n', '')), false);                                              // one of the nine missing
  // The step or the override saying more than `left`.
  assert.equal(closed(CSS.replace(STEP_EDGE, STEP_EDGE.replace('left: -20px;', 'left: -20px;\n    border-left-color: transparent;'))), false);
  assert.equal(closed(CSS.replace(ASIDE_EDGE, ASIDE_EDGE.replace('left: -12px;', 'left: -12px;\n  border: 0;'))), false);
  // The host rule clipping its own pseudo-element.
  assert.equal(closed(CSS.replace('isolation: isolate;', 'isolation: isolate;\n  overflow: hidden;')), false);
  assert.equal(closed(CSS.replace('isolation: isolate;', 'isolation: isolate;\n  contain: paint;')), false);
  assert.equal(closed(CSS.replace('isolation: isolate;', 'isolation: isolate;\n  --color-ai-edge: transparent;')), false);
  // The token defined a second time, anywhere — `:root` outside @theme, the
  // host, the theme itself, a comment-free duplicate.
  assert.equal(closed(CSS + '\n:root { --color-ai-edge: transparent; }\n'), false);
  assert.equal(closed(CSS + '\n:root { --color-ai-edge: rgb(238 244 251); }\n'), false);
  assert.equal(closed(CSS.replace('  --color-ai-edge: #2F5C8F;', '  --color-ai-edge: #2F5C8F;\n  --color-ai-edge: #EEF4FB;')), false);
  // The host tag or class string carrying a clip the sheet never sees.
  assert.equal(P.hostIsBare(RESULT.replace('data-ai-authored={aiAuthored || undefined}>', 'data-ai-authored={aiAuthored || undefined} style={{ overflow: \'hidden\' }}>')), false);
  assert.equal(P.hostClassesAreClosed(RESULT.replace("'scroll-mt-24 ai-authored'", "'scroll-mt-24 ai-authored overflow-hidden'")), false);
  assert.equal(P.hostClassesAreClosed(RESULT.replace("'ai-authored'", "'ai-authored contain-paint'")), false);
  // Spacing: a flush surface, a one-sided bleed, a host with padding, no
  // stacking context, and — the width-specific shape — a responsive step that
  // goes positive while the base rule stays correct.
  assert.equal(P.surfaceHasOwnSpacing(CSS.replace('inset: -6px -12px;', 'inset: 0;')), false);
  assert.equal(P.surfaceHasOwnSpacing(CSS.replace('inset: -6px -12px;', 'inset: -6px 0;')), false);
  assert.equal(P.surfaceHasOwnSpacing(CSS.replace('inset: -6px -20px;', 'inset: -6px 20px;')), false);
  // The responsive ::after step removed (the ::before step and the aside
  // override stay, so a bare rule count would still see two insets).
  const RESPONSIVE_RULE = '@media (min-width: 640px) {\n  .ai-authored::after {\n    inset: -6px -20px;\n  }\n';
  assert.ok(CSS.includes(RESPONSIVE_RULE), 'responsive rule body drifted — re-anchor the red proof');
  assert.equal(P.surfaceHasOwnSpacing(CSS.replace(RESPONSIVE_RULE, '@media (min-width: 640px) {\n')), false);
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
  assert.equal(P.tintHasOwnTokens(CSS.replace('--color-ai-edge:', '--color-ai-edge-x:')), false);
  assert.equal(P.tintHasOwnTokens(CSS.replace('  --color-ai-tint: #EEF4FB;', '  --color-ai-tint: #EEF4FB;\n  --color-ai-dot:  #2F5C8F;')), false);
  assert.equal(P.exportersBlindToTint(EXPORTERS + "\nconst leak = document.querySelector('.ai-authored');"), false);
  assert.equal(P.exportersBlindToTint(EXPORTERS + '\n// fields_touched mentioned only here\nconst x = fields_touched;'), false);
  assert.equal(P.editNeverPostsTouched(API.replace('chars_changed: charsChanged', 'chars_changed: charsChanged, fields_touched: touched')), false);
  assert.equal(P.everyKeyHosted(RESULT.replace("aiAuthored('terapia')", "aiAuthored('terapia_')"), TINT_KEYS), false);
  assert.equal(P.hostCarriesNoText(RESULT.replace('data-ai-authored={aiAuthored || undefined}>', 'data-ai-authored={aiAuthored || undefined} title="AI">')), false);
  assert.equal(P.typeIsSibling(TYPES.replace('export interface TranscribeFields {', 'export interface TranscribeFields {\n  fields_touched?: FieldsTouched;')), false);
});
