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
//   3. provenance unarmed → field_sources absent/empty, so the pass never ran
//                           for this note at all. The backend's own rule:
//                           surface that as NOT CHECKED, never as a pass —
//                           and we were surfacing it as a FAIL, on a fresh
//                           note with a full transcript. Found by a refuter.
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
import { hasSourceLookup, sourcesArmed, storedSpanFor } from '../lib/field-sources.ts';

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

/** The `<SourceButton …>` elements, each as its own attribute text. Read the
 *  ELEMENT first, then its attributes — never scan the file for `fieldKey="…"`,
 *  because TextSection carries a `fieldKey` prop too and a file-wide scan
 *  happily reports a neighbour's key for a SourceButton that has none.
 *
 *  Hand-scanned, not a regex. The regex this replaced required `/>` and was
 *  therefore BLIND to a non-self-closing `<SourceButton …></SourceButton>`:
 *  it skipped that element and swallowed forward into the next one, reporting
 *  the NEIGHBOUR's fieldKey — the exact trap the paragraph above says it
 *  avoids. A refuter deleted napravlenia's fieldKey, made the element
 *  non-self-closing, and the gate still reported seven distinct known keys.
 *  Brace depth is tracked so the `=>` inside `onClick={() => …}` is not
 *  mistaken for the closing angle bracket. */
const callSites = (src: string): string[] => {
  const TAG = '<SourceButton';
  const out: string[] = [];
  let i = 0;
  while ((i = src.indexOf(TAG, i)) !== -1) {
    let j = i + TAG.length;
    let depth = 0;
    let quote: string | null = null;
    for (; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push(src.slice(i + TAG.length, j).replace(/\/\s*$/, ''));
    i = j + 1;
  }
  return out;
};

/** How many times the tag appears at all. If this ever exceeds callSites().length
 *  the scanner is skipping an element, which is how G-4 hid. */
const callSiteTagCount = (src: string): number => src.split('<SourceButton').length - 1;

/** fieldKey per call site; undefined where the attribute is missing. */
const callSiteKeys = (src: string): (string | undefined)[] =>
  callSites(src).map((s) => s.match(/(?:^|\s)fieldKey="([^"]*)"/)?.[1]);

/** The field name each call site actually passes to showSource — the thing the
 *  click resolves against. Must equal that site's fieldKey, or the button
 *  suppresses on one field's behalf and opens another's source. */
const callSiteClickKeys = (src: string): (string | undefined)[] =>
  callSites(src).map((s) => s.match(/showSource\('([^']*)'/)?.[1]);

const P = {
  /** The label is rendered in exactly ONE component. A second render site is a
   *  second place the suppression has to be remembered — and it will not be. */
  labelHasOneRenderSite(src: string): boolean {
    const inJsx = [...src.matchAll(/\{resolved \? '[^']*' : '([^']*)'\}/g)].map((m) => m[1]);
    return inJsx.length === 1 && inJsx[0] === LABEL;
  },

  /** SourceButton returns null BEFORE any JSX when any silence applies. The
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
      first.includes('!sourcesArmed') &&
      first.includes('!hasSourceLookup(fieldKey)') &&
      first.includes('return null')
    );
  },

  /** All THREE silences are wired to the same return. Dropping any one puts
   *  the verdict back on a note it was never reached for. */
  guardCoversBothSilences(src: string): boolean {
    const body = bodyOf(src, 'SourceButton');
    const guard = body.split('\n').find((l) => l.includes('return null'));
    if (!guard) return false;
    return (
      guard.includes('!hasTranscript') &&
      guard.includes('!sourcesArmed') &&
      guard.includes('!hasSourceLookup(fieldKey)')
    );
  },

  /** No `disabled` anywhere in SourceButton. The old greyed-out button was the
   *  bug: it still published the verdict, at 40% opacity. */
  noGreyedVariant(src: string): boolean {
    return !/disabled/.test(bodyOf(src, 'SourceButton'));
  },

  /** EVERY call site passes both inputs the guard reads. A site that omits
   *  `fieldKey` does NOT throw — Object.hasOwnProperty.call(map, undefined) is
   *  simply false — it silently suppresses that section for ever. Silent, not
   *  loud, which is why this is pinned rather than left to a runtime error. */
  everyCallSiteFeedsTheGuard(src: string): boolean {
    const sites = callSites(src);
    if (sites.length === 0) return false;
    return sites.every(
      (s) =>
        /(?:^|\s)hasTranscript=\{/.test(s) &&
        /(?:^|\s)sourcesArmed=\{/.test(s) &&
        /(?:^|\s)fieldKey="[^"]+"/.test(s),
    );
  },

  /** ── POLARITY ──────────────────────────────────────────────────────────
   *  The whole change is one boolean, and every inversion of it is
   *  `boolean → boolean`, so TypeScript cannot see any of them. A refuter
   *  inverted this three different ways — the definition, the DiagnosisSection
   *  prop, and a single call site — and the gate stayed 14/14 GREEN each time.
   *  Inverted, the shipped behaviour is exactly backwards: the affordance
   *  vanishes on fresh notes and the verdict returns on every reopened one.
   *  So the polarity is pinned literally, at all three places it can flip. */
  transcriptFlagDefinitionIsUninverted(src: string): boolean {
    return src.includes(
      "const hasTranscript = !!(original.transcript && original.transcript.trim());",
    );
  },

  everyCallSitePassesTheFlagUninverted(src: string): boolean {
    const sites = callSites(src);
    if (sites.length === 0) return false;
    // Exactly `hasTranscript={hasTranscript}` (the six TextSection sites) or
    // `hasTranscript={sourceHasTranscript}` (the one inside DiagnosisSection).
    return sites.every(
      (s) =>
        /(?:^|\s)hasTranscript=\{(?:hasTranscript|sourceHasTranscript)\}/.test(s) &&
        /(?:^|\s)sourcesArmed=\{(?:provenanceArmed|sourceArmed)\}/.test(s),
    );
  },

  diagnosisSectionForwardsTheFlagUninverted(src: string): boolean {
    return (
      src.includes('sourceHasTranscript={hasTranscript}') &&
      !/sourceHasTranscript=\{!/.test(src)
    );
  },

  /** ── RESOLVED WIRING ───────────────────────────────────────────────────
   *  `resolved` decides WHICH sentence renders. Nothing read it: pinning
   *  `resolved={false && …}` at every site — every working link relabelled to
   *  the verdict — left the gate green. Each site must read its OWN key out of
   *  sourceResolvedByField. */
  resolvedIsWiredPerField(src: string): boolean {
    const sites = callSites(src);
    if (sites.length === 0) return false;
    return sites.every((s) => {
      const key = s.match(/(?:^|\s)fieldKey="([^"]*)"/)?.[1];
      if (!key) return false;
      const resolved = s.match(/(?:^|\s)resolved=\{([^}]*)\}/)?.[1]?.trim();
      // The DiagnosisSection site forwards its own prop, which is pinned below.
      if (resolved === 'sourceResolved') return key === 'osnovna_diagnoza';
      return resolved === `sourceResolvedByField.${key}`;
    });
  },

  diagnosisSectionForwardsResolvedForItsOwnField(src: string): boolean {
    return src.includes('sourceResolved={sourceResolvedByField.osnovna_diagnoza}');
  },

  /** The ternary must say two DIFFERENT things. labelHasOneRenderSite counted
   *  render sites but was satisfied when BOTH branches were the verdict. */
  bothSentencesAreDistinct(src: string): boolean {
    return src.includes("{resolved ? 'виж източника' : 'няма ясен източник'}");
  },

  /** ── CLICK AGREEMENT ───────────────────────────────────────────────────
   *  The key the button suppresses on behalf of and the key its click resolves
   *  against must be the same field. A copy-paste that leaves
   *  `fieldKey="terapia"` beside `showSource('obektivno', …)` was invisible. */
  clickAgreesWithFieldKey(src: string): boolean {
    const keys = callSiteKeys(src);
    const clicks = callSiteClickKeys(src);
    if (keys.length === 0) return false;
    return keys.every((k, i) => {
      // DiagnosisSection's site takes an onShowSource callback, not a literal.
      if (clicks[i] === undefined) return k === 'osnovna_diagnoza';
      return clicks[i] === k;
    });
  },

  /** The scanner sees every element there is. G-4: the old regex required `/>`
   *  and silently skipped a non-self-closing element, then swallowed forward
   *  and reported its neighbour's key. */
  scannerSeesEveryElement(src: string): boolean {
    return callSites(src).length === callSiteTagCount(src) && callSiteTagCount(src) > 0;
  },

  /** The bootstrap resets the source SESSION on a same-route ?visit= change.
   *  Without it a banner opened on the previous consultation survives into the
   *  next one and publishes the verdict over an empty transcript — no button
   *  required, so the suppression cannot see it. */
  bootstrapResetsTheSourceSession(src: string): boolean {
    const start = src.indexOf('editedFieldsRef.current = new Map();');
    const end = src.indexOf('const decision = resolveResultBootstrap(');
    if (start === -1 || end === -1 || end < start) return false;
    const block = src.slice(start, end);
    return (
      block.includes('setActiveSourceField(null)') &&
      block.includes('setSourceMode(null)') &&
      block.includes('setSourceSpan(null)')
    );
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

// ── 1b. sourcesArmed — „did the provenance pass run at all?" ───────────────

test('sourcesArmed is false exactly when the pass never ran', () => {
  assert.equal(sourcesArmed(undefined), false, 'legacy row / provenance errored');
  assert.equal(sourcesArmed({}), false, 'present but empty is still not-run');
  assert.equal(sourcesArmed([] as never), false, 'an array is not a source map');
  assert.equal(sourcesArmed(null as never), false);
  assert.equal(sourcesArmed('x' as never), false);
});

test('sourcesArmed is true as soon as the backend wrote anything', () => {
  assert.equal(sourcesArmed({ vitals: { start: 0, end: 5 } } as never), true);
  // Armed even when every entry is out of bounds: the pass RAN, and a field
  // that then fails to resolve has earned its honest „няма ясен източник".
  assert.equal(sourcesArmed({ vitals: { start: 9_000, end: 9_100 } } as never), true);
});

test('armed and resolved are different questions — the label lives between them', () => {
  const src = { vitals: { start: 9_000, end: 9_100 } } as never;
  assert.equal(sourcesArmed(src), true, 'the pass ran');
  assert.equal(storedSpanFor('obektivno', src, 100), null, 'and this field did not resolve');
  // ⇒ armed && !resolved is the ONE state the verdict is true in.
});

test('hasSourceLookup does NOT change resolution — it only decides whether we speak', () => {
  // A mapped field with no usable entries still resolves to null. The label is
  // still correct THERE: we asked, and the answer was no source.
  assert.equal(hasSourceLookup('obektivno'), true);
  assert.equal(storedSpanFor('obektivno', {}, 100), null);
});

// ── 2. The two silences, as the page implements them ───────────────────────

test('SourceButton refuses to render before any JSX, on all three silences', () => {
  assert.ok(P.guardIsFirstStatement(RESULT), 'the null-return must be the first statement');
  assert.ok(
    P.guardCoversBothSilences(RESULT),
    'no-transcript, unarmed-provenance and no-lookup must all gate it',
  );
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

test('the scanner sees every <SourceButton> element in the file', () => {
  assert.ok(P.scannerSeesEveryElement(RESULT), 'an element was skipped — G-4');
  assert.equal(callSites(RESULT).length, 7, 'seven sections carry the affordance');
});

test('POLARITY: the transcript flag is not inverted, at any of its three places', () => {
  assert.ok(P.transcriptFlagDefinitionIsUninverted(RESULT), 'definition inverted');
  assert.ok(P.everyCallSitePassesTheFlagUninverted(RESULT), 'a call site inverts it');
  assert.ok(P.diagnosisSectionForwardsTheFlagUninverted(RESULT), 'DiagnosisSection inverts it');
});

test('RESOLVED: each site reads its OWN field, and the two sentences differ', () => {
  assert.ok(P.resolvedIsWiredPerField(RESULT));
  assert.ok(P.diagnosisSectionForwardsResolvedForItsOwnField(RESULT));
  assert.ok(P.bothSentencesAreDistinct(RESULT));
});

test('the click resolves the same field the button suppresses on behalf of', () => {
  assert.ok(P.clickAgreesWithFieldKey(RESULT));
});

test('the bootstrap clears the source session on a same-route ?visit= change', () => {
  assert.ok(P.bootstrapResetsTheSourceSession(RESULT));
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

/** The guard line, read out of the file rather than retyped. Every mutation
 *  below anchors on this — retyped copies went stale the moment a third
 *  silence was added, and `bad()` then failed with "mutation was a no-op"
 *  instead of testing anything. */
const GUARD_LINE = RESULT.split('\n').find(
  (l) => l.includes('return null;') && l.includes('!hasTranscript'),
)!;

test('RED-PROOF: predicates reject the shapes they exist to catch', () => {
  assert.ok(GUARD_LINE, 'no guard line found — every mutation below is vacuous');
  const bad = (name: string, mutated: string, p: (s: string) => boolean) => {
    // A no-op "mutation" would prove nothing and pass silently.
    assert.notEqual(mutated, RESULT, `mutation was a no-op: ${name}`);
    assert.equal(p(mutated), false, `predicate stayed green on: ${name}`);
  };

  // The original bug, restored: greyed-out instead of absent.
  bad(
    'guard removed, disabled attribute back',
    RESULT.replace(GUARD_LINE + '\n', '      disabled={!hasTranscript}\n'),
    P.guardIsFirstStatement,
  );

  // Half the fix: the recovery path is silenced, anamneza is not.
  bad(
    'lookup silence dropped',
    RESULT.replace(' || !hasSourceLookup(fieldKey)', ''),
    P.guardCoversBothSilences,
  );

  // The third silence dropped — a fresh note whose provenance call errored
  // goes back to declaring no source on every section.
  bad(
    'unarmed-provenance silence dropped',
    RESULT.replace(' || !sourcesArmed', ''),
    P.guardCoversBothSilences,
  );
  bad(
    'a call site stops passing sourcesArmed',
    mutateCallSite(RESULT, 'obektivno', 'sourcesArmed={provenanceArmed}', ''),
    P.everyCallSiteFeedsTheGuard,
  );
  bad(
    'a call site inverts sourcesArmed',
    mutateCallSite(RESULT, 'obektivno', 'sourcesArmed={provenanceArmed}', 'sourcesArmed={!provenanceArmed}'),
    P.everyCallSitePassesTheFlagUninverted,
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
    RESULT.replace(GUARD_LINE + '\n  return (', '  return (').replace(
      '  );\n}\n\n// Amber',
      '  );\n  ' + GUARD_LINE.trim() + '\n}\n\n// Amber',
    ),
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
  // A Cyrillic homoglyph in the key — „а" U+0430, not „a" U+0061. It would
  // suppress a working section silently, and TypeScript cannot see it (fieldKey
  // is a plain string). This is why callSiteKeys reads `[^"]*` and not `\w+`:
  // the ASCII primitive simply fails to match, the key reads as undefined, and
  // an earlier version of this predicate would have gone green on it.
  bad(
    'a Cyrillic homoglyph in a fieldKey',
    mutateCallSite(RESULT, 'terapia', 'fieldKey="terapia"', 'fieldKey="terapiа"'),
    P.callSiteKeysAreDistinctAndKnown,
  );

  // ── The six mutations a refuter got past the gate (2026-08-23) ───────────
  // Every one of these left it 14/14 GREEN. They are the reason the predicates
  // above exist; each is reproduced verbatim so a regression cannot re-open the
  // same hole. All six are boolean→boolean or attribute-level, so `tsc` is
  // blind to them too — this file is the only thing standing between them and
  // a note that says the opposite of the truth.
  bad(
    'G-1a: the transcript flag definition inverted (one `!`)',
    RESULT.replace(
      'const hasTranscript = !!(original.transcript && original.transcript.trim());',
      'const hasTranscript = !(original.transcript && original.transcript.trim());',
    ),
    P.transcriptFlagDefinitionIsUninverted,
  );
  bad(
    'G-1b: DiagnosisSection handed the inverted flag — the prop this diff renamed',
    RESULT.replace('sourceHasTranscript={hasTranscript}', 'sourceHasTranscript={!hasTranscript}'),
    P.diagnosisSectionForwardsTheFlagUninverted,
  );
  bad(
    'G-1c: one call site inverts the flag',
    mutateCallSite(RESULT, 'terapia', 'hasTranscript={hasTranscript}', 'hasTranscript={!hasTranscript}'),
    P.everyCallSitePassesTheFlagUninverted,
  );
  bad(
    'G-2a: every working link relabelled to the verdict',
    RESULT.replaceAll('resolved={sourceResolvedByField.', 'resolved={false && sourceResolvedByField.'),
    P.resolvedIsWiredPerField,
  );
  bad(
    'G-2b: both ternary branches say the verdict',
    RESULT.replace(
      "{resolved ? 'виж източника' : 'няма ясен източник'}",
      "{resolved ? 'няма ясен източник' : 'няма ясен източник'}",
    ),
    P.bothSentencesAreDistinct,
  );
  bad(
    'G-3: fieldKey and the click point at different fields',
    mutateCallSite(RESULT, 'terapia', "showSource('terapia'", "showSource('obektivno'"),
    P.clickAgreesWithFieldKey,
  );
  // G-4. Not via mutateCallSite: this changes the element's CLOSING form, which
  // lives outside the attribute text mutateCallSite operates on. napravlenia
  // loses its fieldKey AND stops self-closing — the shape that defeated the
  // old regex scanner.
  const nonSelfClosing = RESULT.replace(
    '                          fieldKey="napravlenia"\n                        />',
    '                        ></SourceButton>',
  );
  bad('G-4: a missing fieldKey on a non-self-closing element', nonSelfClosing, P.callSiteKeysAreDistinctAndKnown);
  bad(
    'B-1: the bootstrap stops clearing the source session',
    RESULT.replace('    setActiveSourceField(null);\n', ''),
    P.bootstrapResetsTheSourceSession,
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

test('RED-PROOF: the scanner this file used to have was blind to the G-4 shape', () => {
  // scannerSeesEveryElement cannot be reddened by mutating page.tsx — it
  // compares the scanner against a raw tag count, so it only fails if the
  // SCANNER is wrong. Prove it the other way: run the regex this file used to
  // use against the shape a refuter found, and show it under-counts while the
  // hand-scanner does not. Without this, that predicate would be an assertion
  // nobody has ever seen fail.
  const oldRegexScanner = (src: string): string[] =>
    [...src.matchAll(/<SourceButton(?=[\s/])((?:[^/]|\/(?!>))*?)\/>/g)].map((m) => m[1]);

  const nonSelfClosing = RESULT.replace(
    '                          fieldKey="napravlenia"\n                        />',
    '                        ></SourceButton>',
  );
  assert.notEqual(nonSelfClosing, RESULT, 'mutation was a no-op');

  assert.equal(callSiteTagCount(nonSelfClosing), 7, 'seven tags are present either way');
  assert.equal(callSites(nonSelfClosing).length, 7, 'the hand-scanner sees all seven');

  // The mechanical tell: needing `/>`, the old regex ran past the element's
  // `></SourceButton>` and kept going to the next `/>` anywhere in the file.
  const oldEls = oldRegexScanner(nonSelfClosing);
  const swallowed = oldEls.find((s) => s.includes("showSource('napravlenia'"))!;
  const honest = callSites(nonSelfClosing).find((s) => s.includes("showSource('napravlenia'"))!;
  assert.ok(
    swallowed.length > honest.length * 2,
    `old scanner swallowed forward (${swallowed.length} chars vs ${honest.length})`,
  );

  // And the consequence that made it dangerous. It is worse than reporting a
  // WRONG key: the swallowed markup contained the Направления TextSection's own
  // `fieldKey="napravlenia"`, so the old scanner reported exactly the key a
  // reviewer would expect — for an element that no longer has one. Seven
  // distinct, known, plausible keys out of a file with a hole in it.
  const oldKeys = oldEls.map((s) => s.match(/(?:^|\s)fieldKey="([^"]*)"/)?.[1]);
  const newKeys = callSiteKeys(nonSelfClosing);
  assert.ok(oldKeys.every((k) => typeof k === 'string'), 'old scanner reported no gap');
  assert.equal(
    oldKeys[oldEls.indexOf(swallowed)],
    'napravlenia',
    'and the key it invented was the believable one',
  );
  assert.ok(newKeys.includes(undefined), 'the hand-scanner surfaces the missing key');
});

test('RED-PROOF: hasSourceLookup would catch anamneza being silently re-mapped', () => {
  // Not a mutation of the real module (it is frozen at import), but the shape
  // the assertions above depend on: if a future edit adds anamneza to
  // FIELD_SOURCE_LOOKUP, section 1's anamneza test goes red and the reviewer
  // is forced to re-measure its resolve rate before the label comes back.
  assert.equal(hasSourceLookup(UNMAPPED), false);
  assert.notEqual(hasSourceLookup('obektivno'), hasSourceLookup(UNMAPPED));
});
