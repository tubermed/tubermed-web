// scripts/source-label.test.ts — „няма ясен източник" is a VERDICT, and a
// verdict may only be published when it was actually reached (2026-08-23)
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
// Every note reopened from the library (`?visit=`), every reload, every cold
// start rebuilds the page with `transcript: ''` — the backend omits it by
// design. Length zero → storedSpanFor returns null for EVERY field → the page
// printed „няма ясен източник" on six of seven sections while simultaneously
// rendering the AI-provenance tint. That reads as: we wrote this and we cannot
// tell you why. It was not even true — nothing had been checked.
//
// „We can't check right now" is a different statement from „there is no
// source", and on a reopened note only the first one is true. So the label is
// now suppressed in the two cases where the verdict was never reached:
//
//   1. no transcript      → we could not look
//   2. no lookup entry    → the resolver was never asked (anamneza, by the
//                           atomic-fields ruling; measured 0/35 on the locked
//                           baselines against 89.5% for the six mapped fields)
//
// ── WHAT THIS GATE IS ──────────────────────────────────────────────────────
// Two halves. `hasSourceLookup` is a real import, exercised directly. The
// render rules live in a React component that a DOM-free `node --test` cannot
// mount, so those are SOURCE-TEXT predicates in the print-and-phone /
// ai-tint pattern — pure functions over the real file, then (section 4) each
// one fed the shape it exists to reject, so a green here is not decorative.
//
// The regression this gate is really watching for is the OPPOSITE of the bug:
// a suppression that overreaches and silences a section whose source link
// works. Sections 1 and 3 pin that the affordance survives wherever the
// resolver genuinely resolves.
//
// Deliberately does NOT read ../tubermed-backend for the 0/35 measurement.
// A gate that resolves through a sibling repo is green only on a laptop with
// both checked out — that is the exact failure verify-clean-clone exists to
// catch, and verification infrastructure is production.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasSourceLookup, storedSpanFor } from '../lib/field-sources.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const RESULT = read('app/app/scribe/result/page.tsx');

/** The label itself — the exact string the doctor reads on a section header. */
const LABEL = 'няма ясен източник';
/** The banner sentence inside the transcript panel. A different string, and a
 *  different surface: it needs a CLICK, which needs a rendered button. */
const BANNER = 'Няма ясен източник за това поле в транскрипта.';

/** The six fields the backend can quote (lib/field-sources.ts). */
const MAPPED = ['obektivno', 'osnovna_diagnoza', 'napravlenia', 'terapia', 'izsledvania', 'naznacheni'];
/** The seventh section on screen. No lookup entry, by ruling. */
const UNMAPPED = 'anamneza';

// ── Predicates (pure; section 4 feeds them the broken shape) ────────────────

/** The body of a top-level `function Name(` … up to the next top-level
 *  `function` / `const` at column 0. Used to prove WHERE a string lives, not
 *  merely that the file contains it. */
const bodyOf = (src: string, name: string): string => {
  const i = src.indexOf(`function ${name}(`);
  if (i === -1) return '';
  const rest = src.slice(i + 1);
  const j = rest.search(/\n(?:function |const |export )/);
  return j === -1 ? rest : rest.slice(0, j);
};

/** The `<SourceButton … />` elements, each as its own attribute text. Read the
 *  ELEMENT first, then its attributes — never scan the file for `fieldKey="…"`,
 *  because TextSection carries a `fieldKey` prop too and a file-wide scan
 *  happily reports a neighbour's key for a SourceButton that has none. */
const callSites = (src: string): string[] =>
  [...src.matchAll(/<SourceButton\b((?:[^/]|\/(?!>))*?)\/>/g)].map((m) => m[1]);

/** fieldKey per call site; undefined where the attribute is missing. */
const callSiteKeys = (src: string): (string | undefined)[] =>
  callSites(src).map((s) => s.match(/\bfieldKey="(\w+)"/)?.[1]);

const P = {
  /** The label is rendered in exactly ONE component. A second render site is a
   *  second place the suppression has to be remembered — and it will not be. */
  labelHasOneRenderSite(src: string): boolean {
    const inJsx = [...src.matchAll(/\{resolved \? '[^']*' : '([^']*)'\}/g)].map((m) => m[1]);
    return inJsx.length === 1 && inJsx[0] === LABEL;
  },

  /** SourceButton returns null BEFORE any JSX when either silence applies. The
   *  guard must be the component's first statement: a guard placed after the
   *  return renders nothing, and a guard placed inside the JSX is a greyed
   *  variant, which is still the sentence — just quieter. */
  guardIsFirstStatement(src: string): boolean {
    const body = bodyOf(src, 'SourceButton');
    const open = body.indexOf('}) {');
    if (open === -1) return false;
    const first = body.slice(open + 4).trimStart().split('\n')[0];
    return (
      /^if \(/.test(first) &&
      first.includes('!hasTranscript') &&
      first.includes('!hasSourceLookup(fieldKey)') &&
      first.includes('return null')
    );
  },

  /** Both silences are wired to the same return. Dropping either one puts the
   *  verdict back on a note it was never reached for. */
  guardCoversBothSilences(src: string): boolean {
    const body = bodyOf(src, 'SourceButton');
    const guard = body.split('\n').find((l) => l.includes('return null'));
    if (!guard) return false;
    return guard.includes('!hasTranscript') && guard.includes('!hasSourceLookup(fieldKey)');
  },

  /** No `disabled` anywhere in SourceButton. The old greyed-out button was the
   *  bug: it still published the verdict, at 40% opacity. */
  noGreyedVariant(src: string): boolean {
    return !/disabled/.test(bodyOf(src, 'SourceButton'));
  },

  /** EVERY call site passes both inputs the guard reads. A site that omits
   *  `fieldKey` would throw at hasSourceLookup(undefined) or — worse, with a
   *  default — silently opt out of the suppression. */
  everyCallSiteFeedsTheGuard(src: string): boolean {
    const sites = callSites(src);
    if (sites.length === 0) return false;
    return sites.every((s) => /\bhasTranscript=\{/.test(s) && /\bfieldKey="\w+"/.test(s));
  },

  /** Every rendered section names its own key. A copy-pasted site pointing at
   *  a neighbour's key would suppress (or publish) the wrong field. */
  callSiteKeysAreDistinctAndKnown(src: string): boolean {
    const keys = callSiteKeys(src);
    const known = new Set([...MAPPED, UNMAPPED]);
    return (
      keys.length > 0 &&
      keys.every((k): k is string => typeof k === 'string') &&
      new Set(keys).size === keys.length &&
      keys.every((k) => known.has(k as string))
    );
  },

  /** The banner is gated on activeSourceField, which is only ever set inside
   *  showSource — after its empty-transcript early return. So the banner
   *  sentence is unreachable on a recovery path even if a button were somehow
   *  rendered. Defence in depth, and it must stay that way round. */
  bannerIsBehindTheTranscriptGuard(src: string): boolean {
    if (!src.includes(BANNER)) return false;
    const sets = [...src.matchAll(/setActiveSourceField\(\{/g)];
    if (sets.length !== 1) return false; // exactly one place mints the banner
    const body = src.slice(src.indexOf('const showSource = useCallback('), sets[0].index);
    const guard = body.indexOf("if (!transcript.trim())");
    return guard !== -1 && body.indexOf('return;', guard) > guard;
  },
};

// ── 1. hasSourceLookup — the real function, both directions ─────────────────

test('every field the resolver CAN answer for keeps its lookup — the suppression must not overreach', () => {
  for (const k of MAPPED) {
    assert.equal(hasSourceLookup(k), true, `${k} must stay askable — its source link works today`);
  }
});

test('anamneza has no lookup entry — the resolver is never asked, so there is no verdict', () => {
  assert.equal(hasSourceLookup(UNMAPPED), false);
});

test('an unknown / model-invented key is not askable either', () => {
  for (const k of ['alergii', 'pridruzhavashti', 'osnovna_mkb', '', 'toString', 'constructor']) {
    assert.equal(hasSourceLookup(k), false, `${k} must not be treated as mapped`);
  }
});

test('hasSourceLookup agrees with the resolver it reads — unmapped ⇒ storedSpanFor null', () => {
  const src = { vitals: { start: 0, end: 10 }, osnovna_diagnoza: { start: 0, end: 10 } } as never;
  for (const k of [UNMAPPED, 'alergii', 'osnovna_mkb']) {
    assert.equal(hasSourceLookup(k), false);
    assert.equal(storedSpanFor(k, src, 100), null, `${k} resolves nothing — consistent with unmapped`);
  }
});

test('hasSourceLookup does NOT change resolution — it only decides whether we speak', () => {
  // A mapped field with no usable entries still resolves to null. The label is
  // still correct THERE: we asked, and the answer was no source.
  assert.equal(hasSourceLookup('obektivno'), true);
  assert.equal(storedSpanFor('obektivno', {}, 100), null);
});

// ── 2. The two silences, as the page implements them ───────────────────────

test('SourceButton refuses to render before any JSX, on both silences', () => {
  assert.ok(P.guardIsFirstStatement(RESULT), 'the null-return must be the first statement');
  assert.ok(P.guardCoversBothSilences(RESULT), 'both no-transcript and no-lookup must gate it');
});

test('there is no greyed variant — a quieter verdict is still the verdict', () => {
  assert.ok(P.noGreyedVariant(RESULT));
});

test('the label has exactly one render site', () => {
  assert.ok(P.labelHasOneRenderSite(RESULT));
});

test('the banner sentence sits behind showSource’s empty-transcript return', () => {
  assert.ok(P.bannerIsBehindTheTranscriptGuard(RESULT));
});

// ── 3. No call site can opt out (the overreach direction, and its opposite) ──

test('every SourceButton call site feeds the guard', () => {
  assert.ok(P.everyCallSiteFeedsTheGuard(RESULT));
});

test('call-site keys are distinct and known to the resolver map', () => {
  assert.ok(P.callSiteKeysAreDistinctAndKnown(RESULT));
});

test('the six mapped sections still HAVE a call site — this change only removes appearances', () => {
  const keys = new Set(callSiteKeys(RESULT));
  for (const k of MAPPED) {
    assert.ok(keys.has(k), `${k} lost its source affordance — that is the regression, not the fix`);
  }
});

// ── 4. Red-proof — every predicate fed the shape it exists to reject ────────
// An instrument that has never been shown to fail is not evidence, it is
// decoration. Each mutation below is a way this could really regress.

/** Replace inside SourceButton's body only. `page.tsx` has dozens of buttons;
 *  a bare String.replace lands on the FIRST match in the file, which mutated a
 *  component the predicate does not read and produced a flattering green. That
 *  really happened while this gate was being written — hence `mutateIn`, and
 *  hence `bad()` asserting the mutation changed anything at all. */
const mutateIn = (src: string, fn: string, from: string, to: string): string => {
  const body = bodyOf(src, fn);
  assert.ok(body.includes(from), `mutation target absent from ${fn}: ${from.slice(0, 40)}`);
  return src.replace(body, body.replace(from, to));
};

/** Replace inside ONE `<SourceButton …/>` element, found by its fieldKey. The
 *  same file-wide-replace trap bit twice: `fieldKey="obektivno"` also appears
 *  on the TextSection above it, so a bare replace mutated the wrong element
 *  and the predicate stayed green on a shape it should have rejected. */
const mutateCallSite = (src: string, key: string, from: string, to: string): string => {
  const el = callSites(src).find((s) => s.includes(`fieldKey="${key}"`));
  assert.ok(el, `no SourceButton call site for ${key}`);
  assert.ok(el.includes(from), `mutation target absent from the ${key} call site: ${from}`);
  return src.replace(el, el.replace(from, to));
};

test('RED-PROOF: predicates reject the shapes they exist to catch', () => {
  const bad = (name: string, mutated: string, p: (s: string) => boolean) => {
    // A no-op "mutation" would prove nothing and pass silently.
    assert.notEqual(mutated, RESULT, `mutation was a no-op: ${name}`);
    assert.equal(p(mutated), false, `predicate stayed green on: ${name}`);
  };

  // The original bug, restored: greyed-out instead of absent.
  bad(
    'guard removed, disabled attribute back',
    RESULT.replace(
      /  if \(!hasTranscript \|\| !hasSourceLookup\(fieldKey\)\) return null;\n/,
      '      disabled={!hasTranscript}\n',
    ),
    P.guardIsFirstStatement,
  );

  // Half the fix: the recovery path is silenced, anamneza is not.
  bad(
    'lookup silence dropped',
    RESULT.replace(' || !hasSourceLookup(fieldKey)', ''),
    P.guardCoversBothSilences,
  );

  // The other half: anamneza silenced, the reopened note still shouts.
  bad(
    'transcript silence dropped',
    RESULT.replace('!hasTranscript || ', ''),
    P.guardCoversBothSilences,
  );

  // Guard present but after the return — renders, then decides.
  bad(
    'guard moved below the JSX',
    RESULT.replace(
      '  if (!hasTranscript || !hasSourceLookup(fieldKey)) return null;\n  return (',
      '  return (',
    ).replace('  );\n}\n\n// Amber', '  );\n  if (!hasTranscript) return null;\n}\n\n// Amber'),
    P.guardIsFirstStatement,
  );

  // A greyed variant sneaks back in — scoped to SourceButton, because the file
  // is full of other buttons and a file-wide replace lands on the wrong one.
  bad(
    'disabled re-added to the button',
    mutateIn(RESULT, 'SourceButton', 'type="button"', 'type="button"\n      disabled={!resolved}'),
    P.noGreyedVariant,
  );
  bad(
    'disabled:opacity classes re-added',
    mutateIn(RESULT, 'SourceButton', 'hover:opacity-80"', 'hover:opacity-80 disabled:opacity-40"'),
    P.noGreyedVariant,
  );

  // A second render site — the suppression would have to be remembered twice.
  bad(
    'label duplicated into a second component',
    RESULT.replace(
      "{resolved ? 'виж източника' : 'няма ясен източник'}",
      "{resolved ? 'виж източника' : 'няма ясен източник'}{resolved ? 'x' : 'няма ясен източник'}",
    ),
    P.labelHasOneRenderSite,
  );

  // A call site that opts out of the suppression.
  bad(
    'a call site drops fieldKey',
    mutateCallSite(RESULT, 'anamneza', 'fieldKey="anamneza"', ''),
    P.everyCallSiteFeedsTheGuard,
  );
  bad(
    'a call site drops hasTranscript',
    mutateCallSite(RESULT, 'terapia', 'hasTranscript={hasTranscript}', ''),
    P.everyCallSiteFeedsTheGuard,
  );

  // A dropped fieldKey must not be papered over by a neighbour's — this is the
  // shape that made an earlier version of callSiteKeysAreDistinctAndKnown lie.
  bad(
    'a dropped fieldKey reads as undefined, never as the next element’s key',
    mutateCallSite(RESULT, 'obektivno', 'fieldKey="obektivno"', ''),
    P.callSiteKeysAreDistinctAndKnown,
  );

  // Copy-paste: two sections pointing at the same key.
  bad(
    'duplicate fieldKey across sections',
    mutateCallSite(RESULT, 'obektivno', 'fieldKey="obektivno"', 'fieldKey="anamneza"'),
    P.callSiteKeysAreDistinctAndKnown,
  );
  bad(
    'a fieldKey the resolver has never heard of',
    mutateCallSite(RESULT, 'terapia', 'fieldKey="terapia"', 'fieldKey="terapiya"'),
    P.callSiteKeysAreDistinctAndKnown,
  );

  // The banner's transcript guard removed — a click could mint it on a
  // recovery path again.
  bad(
    'showSource loses its empty-transcript return',
    RESULT.replace("      if (!transcript.trim()) {", '      if (false) {'),
    P.bannerIsBehindTheTranscriptGuard,
  );

  // A second minting site for the banner.
  bad(
    'a second setActiveSourceField',
    RESULT.replace(
      'setActiveSourceField({ fieldKey, value });',
      'setActiveSourceField({ fieldKey, value });\n        setActiveSourceField({ fieldKey, value });',
    ),
    P.bannerIsBehindTheTranscriptGuard,
  );
});

test('RED-PROOF: hasSourceLookup would catch anamneza being silently re-mapped', () => {
  // Not a mutation of the real module (it is frozen at import), but the shape
  // the assertions above depend on: if a future edit adds anamneza to
  // FIELD_SOURCE_LOOKUP, section 1's anamneza test goes red and the reviewer
  // is forced to re-measure its resolve rate before the label comes back.
  assert.equal(hasSourceLookup(UNMAPPED), false);
  assert.notEqual(hasSourceLookup('obektivno'), hasSourceLookup(UNMAPPED));
});
