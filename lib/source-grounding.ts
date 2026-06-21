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

export function findSourceSpan(
  fieldKey: string,
  fieldValue: string,
  transcript: string,
): SourceSpan | null {
  if (!fieldValue || !transcript) return null;

  const value = isDiagnosisField(fieldKey) ? stripTrailingMkbCode(fieldValue) : fieldValue;

  const tt = tokenizeWithOffsets(transcript);
  if (tt.length === 0) return null;

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
      return {
        start: vitalRanges[0].start,
        end: vitalRanges[vitalRanges.length - 1].end,
        tokens: vitalRanges,
      };
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
