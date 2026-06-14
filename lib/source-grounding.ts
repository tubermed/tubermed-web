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

export interface SourceSpan {
  start: number; // inclusive char offset into the ORIGINAL transcript
  end: number;   // exclusive
}

// High-frequency, low-signal Bulgarian words that survive the ≥4-letter filter.
// Kept tight on purpose — over-pruning drops real clinical signal. (Shorter
// stopwords like и/на/за/от/се/да are already removed by the length filter.)
const STOPWORDS = new Set<string>([
  'като', 'след', 'пред', 'този', 'тази', 'това', 'тези', 'онзи', 'онази',
  'който', 'която', 'което', 'които', 'има', 'няма', 'беше', 'били', 'били',
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
// (brackets, dashes, dots) and collapses whitespace.
function contentTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t && isContentToken(t));
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

// A run of nearby transcript hits (≤ MAX_GAP non-hit tokens between successive
// hits). The matched region is reported from the first to the last hit.
const MAX_GAP = 3;

export function findSourceSpan(
  fieldKey: string,
  fieldValue: string,
  transcript: string,
): SourceSpan | null {
  if (!fieldValue || !transcript) return null;

  const value = isDiagnosisField(fieldKey) ? stripTrailingMkbCode(fieldValue) : fieldValue;

  const needleList = contentTokens(value);
  const needles = new Set(needleList);
  if (needles.size === 0) return null;

  const tt = tokenizeWithOffsets(transcript);
  if (tt.length === 0) return null;

  // Indices of transcript tokens that match a needle.
  const hitIdx: number[] = [];
  for (let i = 0; i < tt.length; i++) {
    if (needles.has(tt[i].norm)) hitIdx.push(i);
  }
  if (hitIdx.length === 0) return null;

  // Group hits into clusters separated by gaps larger than MAX_GAP.
  const clusters: number[][] = [];
  let cur: number[] = [hitIdx[0]];
  for (let k = 1; k < hitIdx.length; k++) {
    if (hitIdx[k] - hitIdx[k - 1] <= MAX_GAP + 1) cur.push(hitIdx[k]);
    else { clusters.push(cur); cur = [hitIdx[k]]; }
  }
  clusters.push(cur);

  // Score each cluster: coverage of the field's content tokens dominates, with a
  // bonus for adjacent (phrase) hits and tightness.
  function score(c: number[]): number {
    const distinct = new Set(c.map((i) => tt[i].norm)).size;
    const coverage = distinct / needles.size;
    let adjacent = 0;
    for (let k = 1; k < c.length; k++) if (c[k] - c[k - 1] === 1) adjacent++;
    const span = c[c.length - 1] - c[0] + 1;
    const density = distinct / span;
    return coverage * 2 + adjacent * 0.5 + density;
  }

  let best = clusters[0];
  for (const c of clusters) if (score(c) > score(best)) best = c;

  const distinct = new Set(best.map((i) => tt[i].norm)).size;
  const coverage = distinct / needles.size;
  const onlyNeedleLen = needles.size === 1 ? needleList[0].length : 0;

  // Precision gate — accept only a confident match:
  //   • single-token value: that token must be present AND distinctive (≥6 chars)
  //   • multi-token value:  ≥2 distinct tokens AND ≥half the field's tokens
  //   • any value:          ≥4 distinct tokens clustered together is strong on
  //                         its own (long fields rarely reach 50% in one window)
  const accept =
    (needles.size === 1 && distinct === 1 && onlyNeedleLen >= 6) ||
    (needles.size >= 2 && distinct >= 2 && coverage >= 0.5) ||
    distinct >= 4;

  if (!accept) return null;
  return { start: tt[best[0]].start, end: tt[best[best.length - 1]].end };
}
