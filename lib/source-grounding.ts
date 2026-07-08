// Per-field source grounding (Traceability Phase 1a).
//
// Given a structured field's value and the RAW consultation transcript, find the
// character range in the transcript that the value most likely came from — so the
// doctor can click "виж източника" on a field and verify it against what was
// actually said. Pure, deterministic, no network, no React.
//
// Design notes:
//   • PRECISION over recall. A confident, correct span or `null` — never a guess.
//     Showing the wrong source is worse than showing none ("no clear source —
//     verify manually"). Misses are expected and acceptable.
//   • The persisted transcript is RAW Soniox (pre-substitution) while field text
//     is normalized, so exact matches often fail. We match on token overlap with
//     a contiguity bonus, which tolerates the drift.
//   • Cyrillic-aware: JS `\b` / `\w` are ASCII-only, so we tokenize on Unicode
//     letter/number runs via `\p{L}` / `\p{N}` (the `u` flag), as elsewhere.
//   • Diagnosis fields match on the TERM, never the МКБ code — codes are never
//     spoken aloud, so a trailing "— I10" / "(I10)" is stripped before matching.
//   • A1 (2026-06-15): clusters are split by CHARACTER distance between hits, not
//     token-index distance — so dose/frequency runs ("400 мг три пъти") no longer
//     fragment a therapy phrase whose words are physically adjacent.
//   • A2 (2026-06-15): a field word matches a transcript token EXACTLY, by Bulgarian
//     inflection (метформин↔метформинът, base ≥6 chars), or by a SINGLE-character
//     fuzzy edit on a word ≥8 chars. This bridges Soniox corruptions the gazetteer
//     normalized in the NOTE but not in the raw transcript (нитрофуран[т]оин↔…туин,
//     амоксици[к]лин). The bounds are deliberately tighter than the gazetteer's
//     correction threshold — adversarial review (2026-06-15) showed a looser rule
//     collapses OPPOSITE terms (хипертония↔хипотония) and distinct drugs.

import labLexiconData from './lab-lexicon.json';

export interface SourceSpan {
  start: number; // inclusive char offset into the ORIGINAL transcript
  end: number;   // exclusive
  // The individual matched-needle token ranges within [start, end] (A4). Lets the
  // UI highlight ONLY the words that actually grounded and grey the bridging
  // filler/rest, so a partial match can't falsely reassure. Ascending, non-overlapping.
  tokens: { start: number; end: number }[];
}

// High-frequency, low-signal Bulgarian words that survive the ≥4-letter filter.
// Kept tight on purpose — over-pruning drops real clinical signal. (Shorter
// stopwords like и/на/за/от/се/да are already removed by the length filter.)
const STOPWORDS = new Set<string>([
  'като', 'след', 'пред', 'този', 'тази', 'това', 'тези', 'онзи', 'онази',
  'който', 'която', 'което', 'които', 'има', 'няма', 'беше', 'били',
  'съм', 'дето', 'само', 'още', 'така', 'тъй', 'към', 'през', 'без', 'при',
  'около', 'почти', 'много', 'малко', 'спрямо', 'върху', 'между', 'обаче',
]);

// A field token counts as a "content token" (a needle) only when it carries
// signal: ≥4 Unicode letters and not a stopword. Numbers are deliberately NOT
// needles — values like "120" / "2" recur all over a transcript and would erode
// precision.
function isContentToken(t: string): boolean {
  if (STOPWORDS.has(t)) return false;
  const letters = (t.match(/\p{L}/gu) || []).length;
  return letters >= 4;
}

// Lowercase + split on any non-(letter|number) run. Inherently strips punctuation
// (brackets, dashes, dots) and collapses whitespace. Deduped — each distinct word
// is one needle.
function contentTokens(s: string): string[] {
  return [
    ...new Set(
      s
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t && isContentToken(t)),
    ),
  ];
}

interface TToken {
  norm: string;
  start: number; // offset into the ORIGINAL transcript
  end: number;
}

// Tokenize the transcript while keeping each token's ORIGINAL char offsets, so a
// matched window can be reported as a range into the untouched transcript.
function tokenizeWithOffsets(text: string): TToken[] {
  const out: TToken[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ norm: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function isDiagnosisField(fieldKey: string): boolean {
  return /diagnoz/i.test(fieldKey) || fieldKey === 'osnovna_mkb' || fieldKey === 'pridruzhavashti';
}

// Strip a trailing МКБ code from a diagnosis term. Codes are a Latin letter + 2
// digits with an optional ".d+" (I10, J45.0, K25.9), rendered as "term — I10",
// "term - I10", "term (I10)", "term, I10" or "term I10". Only the TRAILING code
// is removed (a Cyrillic term body can never look like a Latin code).
function stripTrailingMkbCode(s: string): string {
  return s.replace(/\s*[—–\-(,]?\s*\(?[A-Za-z]\d{2}(?:\.\d+)?\)?\s*$/u, '').trim();
}

// ── Fuzzy matching (A2) ──────────────────────────────────────────────────────
// Recovers Soniox STT corruptions the gazetteer fixed in the NOTE but not in the
// raw transcript. Deliberately TIGHTER than the gazetteer's correction threshold:
// a single-character edit on a word of ≥8 chars only. Adversarial review
// (2026-06-15) showed the gazetteer's min(floor(len/5),2) was far too loose for
// MATCHING — it collapsed clinically OPPOSITE terms 2 edits apart (хипертония↔
// хипотония, хипергликемия↔хипогликемия) and distinct drugs (азитромицин↔
// еритромицин, преднизолон↔преднизон). Distance 1 + length ≥ 8 keeps the real
// recoveries (нитрофуран[т]оин↔…туин, метилпреднизол[о/а]н, амоксици[к]лин) while
// rejecting those. (1-edit real minimal pairs like панкреатит↔панкреатин stay
// indistinguishable from a slip — but the doctor sees the actual highlighted word.)
const FUZZY_MIN_LEN = 8;

// Bounded Levenshtein over Unicode code points (a Cyrillic letter is one edit, not
// a UTF-16 fragment). Returns max+1 as soon as the answer cannot be ≤ max.
function levenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const A = [...a];
  const B = [...b];
  const la = A.length;
  const lb = B.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array<number>(lb + 1);
  let cur = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[lb];
}

// Bulgarian noun inflections (definite article + plural), mirroring the gazetteer.
// Lets "метформин" match its definite form "метформинът" (edit distance 2, which
// is beyond the fuzzy threshold for a 9-char word).
const BG_INFLECTION_SUFFIXES = new Set<string>([
  'а', 'я', 'ът', 'ят', 'та', 'то', 'те', 'ите', 'и', 'ове', 'ета',
]);

function isInflectionMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // Base ≥6 chars: avoids short-word false friends where a common Bulgarian word
  // is the medical word + an article (врата→вратата[door], маса→масата[table],
  // стол→стола[chair]); still bridges метформин→метформинът.
  if (short.length < 6) return false;
  if (!long.startsWith(short)) return false;
  return BG_INFLECTION_SUFFIXES.has(long.slice(short.length));
}

// Index of the needle that matches a transcript token, or -1. Priority:
// exact → Bulgarian inflection → single-edit fuzzy (long words only).
function matchNeedle(tnorm: string, needles: string[]): number {
  for (let i = 0; i < needles.length; i++) if (needles[i] === tnorm) return i;
  for (let i = 0; i < needles.length; i++) if (isInflectionMatch(needles[i], tnorm)) return i;
  for (let i = 0; i < needles.length; i++) {
    const n = needles[i];
    if (n.length < FUZZY_MIN_LEN) continue;
    if (Math.abs(n.length - tnorm.length) > 1) continue; // prefilter (distance ≤ 1)
    if (levenshtein(n, tnorm, 1) === 1) return i;
  }
  return -1;
}

// Two hits belong to the same cluster when ≤ CHAR_GAP characters of filler sit
// between them (A1). Bounding by characters — not token count — lets dense
// dose/frequency runs ("400 мг три пъти дневно") stay in one cluster while still
// breaking across a sentence of unrelated prose.
const CHAR_GAP = 30;

// ── Vital-aware grounding (Обективен статус only) ─────────────────────────────
// The vitals field is mostly NUMBERS (RR 130/89, пулс 78, ДЧ 16) — exactly the
// tokens the precision-first matcher drops as needles, so the clearest sourced
// facts contribute nothing and the section falls below the coverage gate → a
// confusing "no source" even when the BP/RR was clearly said. Vitals therefore
// ground through a SEPARATE, tighter rule: a typed field value (parsed cue-then-
// number, the clinical writing order) must reappear in the transcript sitting with
// a cue of the SAME vital type. A bare number never grounds on its own, and this
// runs ONLY for the vitals field — precision everywhere else is untouched. The cue
// vocabulary mirrors lib/vital-rules.ts VITAL_RULES (the canonical range-classifier);
// here we need the VALUE regardless of range, so a normal RR 130/89 parses too.
function isVitalsField(fieldKey: string): boolean {
  return fieldKey === 'obektivno';
}

type VitalType = 'bp' | 'hr' | 'rr' | 'temp' | 'spo2';

// FIELD-side patterns: cue label THEN value ("RR: 130/89", "ДЧ: 16/мин"); an
// unmeasured "ЧСС: не е измерено" yields no number. Cue alternations mirror
// vital-rules.ts.
const FIELD_VITAL_PATTERNS: { type: VitalType; re: RegExp }[] = [
  { type: 'bp', re: /(?:кръвно(?:\s+налягане)?|артериално\s+налягане|АН|RR)\s*[:\s]*(\d{2,3})\s*(?:[/\-–]|на)\s*(\d{2,3})/giu },
  { type: 'hr', re: /(?:пулс|сърдечна\s+честота|ЧСС|HR)\s*[:\s]*(\d{2,3})/giu },
  { type: 'rr', re: /(?:ДЧ|ЧД|дихателна\s+честота|честота\s+на\s+дишане(?:то)?)\s*[:\s]*(\d{1,2})/giu },
  { type: 'temp', re: /(?:температур\p{L}*|темп\.?|t-ра|t°)\s*[:\s]*(\d{2}(?:[.,]\d{1,2})?)/giu },
  { type: 'spo2', re: /(?:кислородна\s+сатурация|сатурация|SpO2|SatO2)\s*[:\s]*(\d{2,3})/giu },
];

// TRANSCRIPT-side cue stems (startsWith on a lowercased token) — broader than the
// field labels to catch the spoken forms ("дихателни движения", "удара в минута").
const VITAL_CUE_STEMS: Record<VitalType, string[]> = {
  bp: ['кръвн', 'наляган', 'артериал'],
  hr: ['пулс', 'сърдечн', 'удар', 'чсс'],
  rr: ['дихател', 'дишан', 'дч'],
  temp: ['температур', 'градус'],
  spo2: ['сатураци', 'кислород'],
};

const VITAL_CUE_WINDOW = 24; // max chars between a vital number and its cue
const BP_PAIR_GAP = 6;       // max chars between the two BP numbers ("130 на 89")

interface FieldVital {
  type: VitalType;
  nums: number[];
}

function parseFieldVitals(value: string): FieldVital[] {
  const out: FieldVital[] = [];
  for (const { type, re } of FIELD_VITAL_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value))) {
      const nums = [m[1], m[2]]
        .filter((x): x is string => Boolean(x))
        .map((x) => parseInt(x, 10))
        .filter((n) => !Number.isNaN(n));
      if (nums.length) out.push({ type, nums });
    }
  }
  return out;
}

// Char gap between a token and a [lo, hi] range (0 when they overlap).
function gapTo(t: TToken, lo: number, hi: number): number {
  if (t.start >= hi) return t.start - hi;
  if (t.end <= lo) return lo - t.end;
  return 0;
}

// The closest SAME-TYPE cue token within the window of [lo, hi], or null.
function nearestCue(tt: TToken[], stems: string[], lo: number, hi: number): TToken | null {
  let best: TToken | null = null;
  let bestGap = Infinity;
  for (const t of tt) {
    if (!stems.some((s) => t.norm.startsWith(s))) continue;
    const g = gapTo(t, lo, hi);
    if (g <= VITAL_CUE_WINDOW && g < bestGap) {
      best = t;
      bestGap = g;
    }
  }
  return best;
}

// Transcript char-ranges that ground a typed field vital. Precision-first: a BP
// grounds only as an ADJACENT pair (sys→dia) near a BP cue; a single-number vital
// grounds only when the SAME number sits within VITAL_CUE_WINDOW of a SAME-TYPE
// cue. Returns ascending, non-overlapping ranges.
function groundVitalRanges(value: string, tt: TToken[]): { start: number; end: number }[] {
  const fieldVitals = parseFieldVitals(value);
  if (fieldVitals.length === 0) return [];

  const numTokens = tt.filter((t) => /^\d+$/.test(t.norm));
  const ranges: { start: number; end: number }[] = [];

  for (const fv of fieldVitals) {
    const stems = VITAL_CUE_STEMS[fv.type];
    if (fv.type === 'bp' && fv.nums.length >= 2) {
      const [sys, dia] = fv.nums;
      for (let i = 0; i < numTokens.length - 1; i++) {
        const a = numTokens[i];
        const b = numTokens[i + 1];
        if (parseInt(a.norm, 10) !== sys || parseInt(b.norm, 10) !== dia) continue;
        if (b.start - a.end > BP_PAIR_GAP) continue;
        if (!nearestCue(tt, stems, a.start, b.end)) continue;
        ranges.push({ start: a.start, end: b.end });
        break;
      }
    } else {
      for (const num of fv.nums) {
        let grounded = false;
        for (const t of numTokens) {
          if (parseInt(t.norm, 10) !== num) continue;
          const cue = nearestCue(tt, stems, t.start, t.end);
          if (!cue) continue;
          ranges.push({ start: Math.min(t.start, cue.start), end: Math.max(t.end, cue.end) });
          grounded = true;
          break;
        }
        if (grounded) break; // one ground per field vital is enough
      }
    }
  }

  ranges.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

// ── Lab-list grounding (Изследвания only) ─────────────────────────────────────
// The investigations fields (izsledvania = results, naznacheni = ordered tests)
// are comma-separated lab labels that the extractor NORMALIZES to canonical short
// forms (ПКК, СУЕ, CRP, hs-CRP …). Those tokenize below the ≥4-letter needle bar,
// so the precision-first text matcher drops them and a section whose labs are
// plainly in the transcript collapses to "no clear source". We bridge each item
// back to its spoken form(s) via the committed lab lexicon (a mirror of the
// backend LAB_ENTRIES — the same table that normalized the labels), then require
// those spoken words to ACTUALLY be present. An un-spoken lab grounds to nothing,
// so the honest "no clear source" is preserved; matching stays scoped to these
// two fields, so precision everywhere else is untouched.
interface LabEntry {
  id: string;
  label: string;
  aliases: string[];
  parent: string | null;
}
const LAB_ENTRIES: LabEntry[] = (labLexiconData as { entries: LabEntry[] }).entries;

// Mirrors the backend normKey: trim + lowercase + collapse internal whitespace.
function labNormKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/gu, ' ');
}

// normKey → LAB_ENTRIES index (first-wins, mirroring the backend buildIndex:
// a label is registered before its own aliases, an earlier entry before a later).
const LAB_KEY_INDEX: Map<string, number> = (() => {
  const m = new Map<string, number>();
  LAB_ENTRIES.forEach((e, i) => {
    const add = (raw: string) => {
      const k = labNormKey(raw);
      if (k && !m.has(k)) m.set(k, i);
    };
    add(e.label);
    for (const a of e.aliases) add(a);
  });
  return m;
})();

function isLabField(fieldKey: string): boolean {
  return fieldKey === 'izsledvania' || fieldKey === 'naznacheni';
}

// Resolve one list item to its canonical lab entry. Whole-string first; on a
// miss, retry the LEADING label portion (a results item trails a value/unit
// after the label — "CRP 12 mg/L", "гликиран хемоглобин 7.2%"), dropping trailing
// words. Leading-only — never a mid-string substring — so a modified phrase like
// "Контролна кръвна картина" (starts with "контролна") can't resolve to ПКК,
// keeping the backend's whole-string classify discipline. A mis-resolve is
// harmless anyway: it only picks which lab's spoken forms to SEARCH, and
// grounding still requires one of them to be present in the transcript.
function resolveLab(item: string): LabEntry | null {
  const whole = LAB_KEY_INDEX.get(labNormKey(item));
  if (whole !== undefined) return LAB_ENTRIES[whole];
  const words = item.trim().split(/\s+/u);
  for (let n = words.length - 1; n >= 1; n--) {
    const k = LAB_KEY_INDEX.get(labNormKey(words.slice(0, n).join(' ')));
    if (k !== undefined) return LAB_ENTRIES[k];
  }
  return null;
}

// The spoken variants to search for a resolved lab: its canonical label plus
// every alias. The subtype→parent link is deliberately NOT followed — grounding
// a subtype (hs-CRP) to a bare mention of the general test (CRP) would overstate
// what was actually said.
function labSearchForms(e: LabEntry): string[] {
  return [...new Set([e.label, ...e.aliases])];
}

// Exact, in-order, adjacent token-sequence match — for pure-abbreviation forms
// (ПКК, hs-CRP, TG) that carry no ≥4-letter needle. EXACT only: no fuzzy, no
// inflection (an abbreviation must never fuzzy-collapse onto a neighbour).
// Returns the matched transcript token indices, or null.
const LAB_ABBREV_GAP = 4; // 'hs' and 'crp' in a spoken "hs-CRP" sit ~1–2 chars apart
function matchExactSequence(seq: string[], tt: TToken[]): number[] | null {
  const n = seq.length;
  if (n === 0) return null;
  for (let i = 0; i + n <= tt.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if (tt[i + j].norm !== seq[j]) { ok = false; break; }
      if (j > 0 && tt[i + j].start - tt[i + j - 1].end > LAB_ABBREV_GAP) { ok = false; break; }
    }
    if (ok) return Array.from({ length: n }, (_, j) => i + j);
  }
  return null;
}

// A Bulgarian connector/function word inside a lab long-form — skippable when
// matching the phrase ("скорост НА утаяване", "креатинин В кръвта").
const LAB_CONNECTORS = new Set<string>([
  'на', 'и', 'в', 'за', 'от', 'с', 'със', 'по', 'до', 'или',
]);

// A form's REQUIRED anchors, in order: content words (≥4 letters → matchNeedle,
// so exact/inflection/fuzzy) and short abbreviation fragments (crp, ldl, т4, лош,
// and single distinguishing letters like the Д of "витамин Д"/"Д-димер" → exact).
// Connectors and pure-number/value tokens are dropped; the "с" of "С-реактивен"
// falls out because it is a connector. This is what a spoken form must ACTUALLY
// contain to ground — the generic word an alias happens to collapse to (a bare
// "холестерол", "висок", "реактивен") never grounds the lab on its own.
interface LabAnchor { norm: string; content: boolean }
function labAnchors(form: string): { anchors: LabAnchor[]; raw: string[] } {
  const raw = form.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const anchors: LabAnchor[] = [];
  for (const t of raw) {
    if (LAB_CONNECTORS.has(t)) continue;
    const letters = (t.match(/\p{L}/gu) || []).length;
    if (letters === 0) continue; // pure numbers/values are not anchors (as in isContentToken)
    if (letters >= 4 && !STOPWORDS.has(t)) anchors.push({ norm: t, content: true });
    else anchors.push({ norm: t, content: false }); // abbr/short/qualifier anchor (crp, ldl, д)
  }
  return { anchors, raw };
}

// Match a multi-anchor form as a CONTIGUOUS spoken phrase: the anchors appear in
// order, immediately consecutive except for skippable connector words, and with
// NO sentence boundary between them. This is the precision core — it rejects a
// form whose words merely sit nearby in unrelated prose ("добър контрол на
// холестерола" ≠ HDL "добър холестерол"; "висок и чувствителен. CRP" ≠ hs-CRP)
// while accepting the real phrase and its inflections/connectors ("скорост на
// утаяване на еритроцитите"). Returns the matched transcript token indices, or null.
function matchLabPhrase(anchors: LabAnchor[], tt: TToken[], transcript: string): number[] | null {
  const matches = (a: LabAnchor, norm: string) =>
    a.content ? matchNeedle(norm, [a.norm]) === 0 : norm === a.norm;
  for (let s = 0; s < tt.length; s++) {
    if (!matches(anchors[0], tt[s].norm)) continue;
    const picks = [s];
    let prevEnd = tt[s].end;
    let ri = 1;
    let ok = true;
    for (let j = s + 1; ri < anchors.length; j++) {
      if (j >= tt.length) { ok = false; break; }
      if (matches(anchors[ri], tt[j].norm)) {
        // a sentence boundary must never sit between two anchors of one lab name
        if (/[.!?;\n]/u.test(transcript.slice(prevEnd, tt[j].start))) { ok = false; break; }
        picks.push(j); prevEnd = tt[j].end; ri++;
        continue;
      }
      if (LAB_CONNECTORS.has(tt[j].norm)) continue; // a connector between anchors is allowed
      ok = false; break; // an unrelated token between anchors → this occurrence fails
    }
    if (ok && ri === anchors.length) return picks;
  }
  return null;
}

// Ground one spoken FORM (a lexicon label or alias) against the transcript:
//   • pure abbreviation (ПКК, CRP, hs-CRP, LDL) — no content anchor → an exact,
//     adjacent token sequence; an ultra-short one (<3 chars, e.g. ГФ/ТГ) never
//     grounds standalone — too collision-prone;
//   • single content word (креатинин, урея) — present via matchNeedle and ≥
//     singleMinLen chars (4 for a confirmed lexicon lab, the generic 6 for the
//     unknown-item fallback);
//   • multi-anchor phrase (пълна кръвна картина, LDL холестерол, high-sensitive
//     CRP, витамин Д) — ALL anchors as a contiguous spoken phrase (matchLabPhrase).
// Returns matched token indices, or null.
function groundLabForm(
  form: string,
  tt: TToken[],
  transcript: string,
  singleMinLen: number,
): number[] | null {
  const { anchors, raw } = labAnchors(form);
  if (anchors.length === 0) return raw.join('').length >= 3 ? matchExactSequence(raw, tt) : null;
  if (!anchors.some((a) => a.content)) {
    const seq = anchors.map((a) => a.norm);
    return seq.join('').length >= 3 ? matchExactSequence(seq, tt) : null;
  }
  if (anchors.length === 1) {
    const a = anchors[0];
    if (a.norm.length < singleMinLen) return null;
    for (let i = 0; i < tt.length; i++) if (matchNeedle(tt[i].norm, [a.norm]) === 0) return [i];
    return null;
  }
  return matchLabPhrase(anchors, tt, transcript);
}

// Per-ITEM lab grounding: split the field into its listed labs (comma / semicolon
// / "и"-separated), resolve each to its lexicon entry and search its spoken forms
// (longest match wins); an unknown item falls back to grounding its own text.
// Union the matched token ranges of every item that actually grounded. Returns
// null when nothing grounded (→ the caller's honest "no clear source"), so an
// un-spoken lab is never invented.
function groundLabList(value: string, tt: TToken[], transcript: string): SourceSpan | null {
  const items = value.split(/[,;·\n]+|\s+и\s+/u).map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return null;

  const hitTokens = new Set<number>();
  for (const item of items) {
    const entry = resolveLab(item);
    let best: number[] | null = null;
    if (entry) {
      // Confirmed lab → a 4-char single-word floor (a lexicon term is safe short).
      for (const form of labSearchForms(entry)) {
        const r = groundLabForm(form, tt, transcript, 4);
        if (r && (!best || r.length > best.length)) best = r;
      }
    } else {
      // Unknown item → the generic 6-char single-word precision floor.
      best = groundLabForm(item, tt, transcript, 6);
    }
    if (best) for (const i of best) hitTokens.add(i);
  }
  if (hitTokens.size === 0) return null;

  const idxs = [...hitTokens].sort((a, b) => a - b);
  const tokens: { start: number; end: number }[] = [];
  for (const i of idxs) {
    const last = tokens[tokens.length - 1];
    if (last && tt[i].start <= last.end) last.end = Math.max(last.end, tt[i].end);
    else tokens.push({ start: tt[i].start, end: tt[i].end });
  }
  return { start: tokens[0].start, end: tokens[tokens.length - 1].end, tokens };
}

export function findSourceSpan(
  fieldKey: string,
  fieldValue: string,
  transcript: string,
): SourceSpan | null {
  if (!fieldValue || !transcript) return null;

  const value = isDiagnosisField(fieldKey) ? stripTrailingMkbCode(fieldValue) : fieldValue;

  const tt = tokenizeWithOffsets(transcript);
  if (tt.length === 0) return null;

  // Lab-list grounding (izsledvania/naznacheni): bridge normalized short-form
  // labels back to their spoken variants via the lab lexicon. These fields are
  // governed ENTIRELY by the lab path — its per-item precision (require the
  // abbreviation or the full spoken phrase) must not be undercut by the generic
  // single-word matcher, which would otherwise ground a resolved "свободен Т4" to
  // the bare adjective "свободен". A miss returns the honest null.
  if (isLabField(fieldKey)) return groundLabList(value, tt, transcript);

  // Text needles (numbers excluded by design — see isContentToken). May be empty
  // for a numbers-only vitals field; the vital pass below handles that.
  const needles = contentTokens(value);

  // For each transcript token, the index of the needle it grounds (or -1). Hits
  // are the grounded tokens.
  const matched: number[] = new Array(tt.length).fill(-1);
  const hitIdx: number[] = [];
  for (let i = 0; i < tt.length; i++) {
    const ni = needles.length ? matchNeedle(tt[i].norm, needles) : -1;
    matched[i] = ni;
    if (ni >= 0) hitIdx.push(i);
  }

  // Group text hits into clusters separated by more than CHAR_GAP characters
  // (empty when there are no text hits).
  const clusters: number[][] = [];
  if (hitIdx.length > 0) {
    let cur: number[] = [hitIdx[0]];
    for (let k = 1; k < hitIdx.length; k++) {
      const gapChars = tt[hitIdx[k]].start - tt[hitIdx[k - 1]].end;
      if (gapChars <= CHAR_GAP) cur.push(hitIdx[k]);
      else { clusters.push(cur); cur = [hitIdx[k]]; }
    }
    clusters.push(cur);
  }

  const distinctOf = (c: number[]) => new Set(c.map((i) => matched[i])).size;

  // Vital-aware pass (Обективен статус only): when a typed field vital actually
  // grounds in the transcript, return those ranges — numbers ARE the signal here,
  // and the precision-first text gate below would otherwise reject the section.
  if (isVitalsField(fieldKey)) {
    const vitalRanges = groundVitalRanges(value, tt);
    if (vitalRanges.length > 0) {
      // Partial-match honesty: also light the grounded PROSE — any ≥2-needle text
      // phrase like "очистено дишането" — so every word that grounded is shown and
      // the rest is greyed, instead of only the numbers. Unsourced field clauses
      // (the injected "не е измерено", a fabricated "везикуларно") have no
      // transcript match and stay unlit — the fabrication is never blended into a
      // confident-looking source.
      const ranges = [...vitalRanges];
      for (const c of clusters) {
        if (distinctOf(c) < 2) continue;
        for (const i of c) ranges.push({ start: tt[i].start, end: tt[i].end });
      }
      ranges.sort((a, b) => a.start - b.start);
      const tokens: { start: number; end: number }[] = [];
      for (const r of ranges) {
        const last = tokens[tokens.length - 1];
        if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
        else tokens.push({ ...r });
      }
      return { start: tokens[0].start, end: tokens[tokens.length - 1].end, tokens };
    }
  }

  if (hitIdx.length === 0) return null;

  // Score each cluster: coverage of the field's content tokens dominates, with a
  // bonus for adjacent (phrase) hits and tightness.
  function score(c: number[]): number {
    const distinct = distinctOf(c);
    const coverage = distinct / needles.length;
    let adjacent = 0;
    for (let k = 1; k < c.length; k++) if (c[k] - c[k - 1] === 1) adjacent++;
    const span = c[c.length - 1] - c[0] + 1;
    const density = distinct / span;
    return coverage * 2 + adjacent * 0.5 + density;
  }

  let best = clusters[0];
  for (const c of clusters) if (score(c) > score(best)) best = c;

  const distinct = distinctOf(best);
  const coverage = distinct / needles.length;
  const onlyNeedleLen = needles.length === 1 ? needles[0].length : 0;

  // Precision gate — accept only a confident match:
  //   • single-token value: that token must be present AND distinctive (≥6 chars)
  //   • multi-token value:  ≥2 distinct tokens AND ≥half the field's tokens
  //   • any value:          ≥4 distinct tokens clustered together is strong on
  //                         its own (long fields rarely reach 50% in one window)
  const accept =
    (needles.length === 1 && distinct === 1 && onlyNeedleLen >= 6) ||
    (needles.length >= 2 && distinct >= 2 && coverage >= 0.5) ||
    distinct >= 4;

  if (!accept) return null;
  return {
    start: tt[best[0]].start,
    end: tt[best[best.length - 1]].end,
    tokens: best.map((i) => ({ start: tt[i].start, end: tt[i].end })),
  };
}
