// Highlight rules for Bulgarian clinical text:
//   - vital-sign detection (temperature, BP, HR, SpO2, ДЧ) with normal-range
//     classification
//   - blood-pressure data sanity (systolic ≤ diastolic → critical)
//   - low-confidence transcription markers (text wrapped in [[...]])

export type HighlightKind =
  | 'vital-warn'
  | 'vital-critical'
  | 'uncertain'        // low-confidence TRANSCRIPTION marker ([[...]] in the text)
  | 'ai-uncertain';    // backend AI-uncertainty span (fields.uncertain_spans, A2)

export interface HighlightMatch {
  start: number;       // position in source text
  end: number;
  kind: HighlightKind;
  raw: string;         // source text actually matched (incl. any [[...]])
  display: string;     // what to render inside the highlight (e.g. inner word, no brackets)
  label: string;       // short category label e.g. "Температура"
  message: string;     // human-readable reason
  suggestion?: string; // optional proposed correction (ai-uncertain spans)
}

function parseDecimal(s: string): number {
  return parseFloat(s.replace(',', '.'));
}

// ── Vital rules ───────────────────────────────────────────────

export interface VitalRule {
  category: string;
  label: string;
  pattern: RegExp;
  classify: (
    m: RegExpExecArray
  ) => { kind: 'vital-warn' | 'vital-critical'; message: string } | null;
}

// Exported so scripts/vital-rules.test.ts can assert it is non-empty and that
// every keyword spelling in every rule is exercised — a gate that silently
// probes a subset of the rules is the vacuity shape this repo keeps finding.
export const VITAL_RULES: VitalRule[] = [
  // Temperature
  {
    category: 'temp',
    label: 'Температура',
    pattern:
      /(?:температурата?|температурата|темп(?:\.|ература(?:та)?)?|t°?|т°|t-ра)[\s:]*?(\d{2}(?:[,.]\d{1,2})?)\s*°?\s*[CcсС]?/giu,
    classify: (m) => {
      const v = parseDecimal(m[1]);
      if (isNaN(v) || v < 25 || v > 45) return null;
      if (v < 34)
        return { kind: 'vital-critical', message: `Тежка хипотермия — ${v}°C (норма 36.0–37.5)` };
      if (v < 35.5)
        return { kind: 'vital-warn', message: `Хипотермия — ${v}°C (под 35.5)` };
      if (v > 39)
        return { kind: 'vital-critical', message: `Висока температура — ${v}°C (норма 36.0–37.5)` };
      if (v > 37.5)
        return { kind: 'vital-warn', message: `Фебрилитет — ${v}°C (над 37.5)` };
      return null;
    },
  },
  // Blood pressure
  {
    category: 'bp',
    label: 'Кръвно налягане',
    pattern:
      /(?:кръвно(?:\s+налягане)?|артериално\s+налягане|АН|RR)\s*[:\s]*(\d{2,3})\s*(?:[/\-–]|на)\s*(\d{2,3})/giu,
    classify: (m) => {
      const sys = parseInt(m[1], 10);
      const dia = parseInt(m[2], 10);
      if (isNaN(sys) || isNaN(dia)) return null;
      // DATA SANITY: systolic must be > diastolic. If not, almost certainly
      // a transcription error (e.g. "60 на 90" instead of "90 на 60").
      if (sys <= dia)
        return {
          kind: 'vital-critical',
          message: `Невалидна стойност — систолно (${sys}) ≤ диастолно (${dia}). Вероятна грешка при разпознаването.`,
        };
      if (sys >= 180 || dia >= 110)
        return {
          kind: 'vital-critical',
          message: `Хипертонична криза — ${sys}/${dia} (≥180/110)`,
        };
      if (sys < 90 || dia < 60)
        return {
          kind: 'vital-warn',
          message: `Хипотония — ${sys}/${dia} (под 90/60)`,
        };
      if (sys >= 140 || dia >= 90)
        return {
          kind: 'vital-warn',
          message: `Хипертония — ${sys}/${dia} (≥140/90)`,
        };
      return null;
    },
  },
  // Heart rate
  {
    category: 'hr',
    label: 'Сърдечна честота',
    pattern:
      /(?:пулс|сърдечна\s+честота|ЧСС|HR)\s*[:\s]*(\d{2,3})(?:\s*(?:удара|у\.|bpm))?/giu,
    classify: (m) => {
      const v = parseInt(m[1], 10);
      if (isNaN(v) || v < 20 || v > 250) return null;
      if (v < 40)
        return { kind: 'vital-critical', message: `Тежка брадикардия — ${v}/мин (норма 60–100)` };
      if (v < 60)
        return { kind: 'vital-warn', message: `Брадикардия — ${v}/мин (под 60)` };
      if (v > 130)
        return { kind: 'vital-critical', message: `Тежка тахикардия — ${v}/мин (норма 60–100)` };
      if (v > 100)
        return { kind: 'vital-warn', message: `Тахикардия — ${v}/мин (над 100)` };
      return null;
    },
  },
  // SpO2
  {
    category: 'spo2',
    label: 'Сатурация',
    pattern:
      /(?:сатурация|SpO2|SatO2|кислородна\s+сатурация)\s*[:\s]*(\d{2,3})\s*%?/giu,
    classify: (m) => {
      const v = parseInt(m[1], 10);
      if (isNaN(v) || v < 50 || v > 100) return null;
      if (v < 90)
        return { kind: 'vital-critical', message: `Тежка хипоксемия — SpO2 ${v}% (норма >95)` };
      if (v < 95)
        return { kind: 'vital-warn', message: `Гранична сатурация — SpO2 ${v}% (под 95)` };
      return null;
    },
  },
  // Respiratory rate (ДЧ / ЧД)
  {
    category: 'rr',
    label: 'Дихателна честота',
    pattern:
      /(?:ДЧ|ЧД|дихателна\s+честота|честота\s+на\s+дишане(?:то)?)\s*[:\s]*(\d{1,2})(?:\s*(?:\/мин|в\s+минута))?/giu,
    classify: (m) => {
      const v = parseInt(m[1], 10);
      if (isNaN(v) || v < 4 || v > 60) return null;
      if (v < 8)
        return { kind: 'vital-critical', message: `Тежка брадипнея — ДЧ ${v}/мин (норма 12–20)` };
      if (v < 12)
        return { kind: 'vital-warn', message: `Брадипнея — ДЧ ${v}/мин (под 12)` };
      if (v > 30)
        return { kind: 'vital-critical', message: `Тежка тахипнея — ДЧ ${v}/мин (норма 12–20)` };
      if (v > 24)
        return { kind: 'vital-warn', message: `Тахипнея — ДЧ ${v}/мин (над 24)` };
      return null;
    },
  },
];

// ── Left boundary ─────────────────────────────────────────────
// Every VITAL_RULES pattern starts with a keyword alternation, and none of them
// carried a left boundary: the `t` of `t°?` matched inside Hct/PLT/ALT/GGT and
// the `АН` of the blood-pressure rule matched inside лозартан/валсартан, so a
// haematology line and an antihypertensive dose range both rendered as red
// clinical criticals. Red is this product's reserved medication-safety colour.
//
// The boundary is an explicit test on the PRECEDING CHARACTER, never `\b`.
// JS `\b` is defined over `[A-Za-z0-9_]` and the `u` flag does not change that,
// so `/\bт/u` is true in the middle of a Cyrillic word and false at the start of
// one — the exact inversion `scripts/ascii-boundary.test.ts` exists to catch.
//
// It is the COMPLEMENT of a word character, deliberately, not an allowlist of
// separators: a refuter replaced it with /[\s.,;:()%|]/ and every gate stayed
// green while „**t 38.5**", „—t 38.5" and „«АН 185/115»" silently stopped
// marking. Clinical text is punctuated by more than five characters.
const BOUNDARY_WORD_CHAR = /[\p{L}\p{N}]/u;

function startsAtWordStart(text: string, index: number): boolean {
  if (index <= 0) return true;
  return !BOUNDARY_WORD_CHAR.test(text[index - 1]);
}

// ── Right boundary, on the NUMBER ────────────────────────────────────────────
// The left boundary stopped a keyword matching mid-word. The captured VALUE had
// the same hole on its right: every quantifier is left-anchored, so a longer
// number was silently truncated to the first two or three digits — and the
// clinical direction inverted with it. Measured on the shipped fix:
//
//     "ДЧ 112"    → «ДЧ 11»  Брадипнея — ДЧ 11/мин (под 12)     ← tachypnoea read as brady
//     "ЧСС 1120"  → «ЧСС 112» Тахикардия
//     "t 385"     → «t 38»   Фебрилитет — 38°C
//
// A digit immediately after a captured value means the number was cut, so the
// match is not a measurement. Same shape as the left boundary, same rule: an
// explicit character test, no `\b`. Requires the `d` flag on every pattern.
// Implemented WITHOUT the `d` flag: capture-group offsets would be the direct
// way to say this, but `d` requires target es2022 and this project targets
// lower — tsc rejects it outright (TS1501). The equivalent statement over the
// whole match: a digit immediately after a match that does NOT end in
// whitespace means the number was cut mid-way.
//
// The whitespace clause is load-bearing, not defensive. Several patterns end in
// a greedy `\s*`, so on "t 36.6 120" the match is "t 36.6 " — trailing space
// included — and the following "1" is a SEPARATE token, not a truncation. Test
// the raw next character alone and that legitimate temperature stops marking.
const DIGIT = /[0-9]/;
const TRAILING_SPACE = /\s$/;

function endsAtNumberBoundary(text: string, m: RegExpExecArray): boolean {
  const matched = m[0];
  if (matched.length === 0) return true;
  if (TRAILING_SPACE.test(matched)) return true; // the digit is a separate token
  const after = text[m.index + matched.length];
  return after === undefined || !DIGIT.test(after);
}

// ── A STATED TARGET IS NOT A MEASUREMENT ─────────────────────────────────────
// „Целева сатурация 88-92%" is the standard COPD oxygen target, and it rendered
// as «Тежка хипоксемия — SpO2 88% (норма >95)»: a red critical warning on a
// correctly-dictated treatment goal. Пулмология is the first specialty likely to
// use this product, and this is a phrase its notes carry routinely.
//
// The mechanism is the acuity detector's, and so are its two hard-won lessons:
//
//   DIRECTION. A goal word governs what FOLLOWS it — „целева сатурация 88" —
//   exactly as „без" governs what follows it. So the lookup runs BACKWARD from
//   the vital, never forward. Letting it reach forward would suppress
//   „Сатурация 82%, целта е над 90" — a real hypoxaemia sitting next to a goal.
//
//   CLAUSE SCOPE. The goal word must be in the SAME clause. Without this, one
//   „целева" at the top of a paragraph silences every vital below it, which is a
//   suppression that swallows the real case — worse than the false positive it
//   was written to remove.
//
// ⚠ WHOLE-TOKEN against an explicit closed set of FORMS, never by prefix. This
// is the ASCII-boundary lesson and the acuity detector's, together: `\b` does
// not exist for Cyrillic, and a `цел`-prefix match would eat „целулит",
// „целувка" and „целесъобразно". The boundaries are \p{L} classes with the `u`
// flag.
//
// ⚠ Bare „поддържа" is DELIBERATELY ABSENT while „поддържай"/„поддържайте"/
// „поддържане" are present. The imperative and the verbal noun state a goal; the
// third-person present describes what the patient is doing — „болният поддържа
// сатурация 85%" IS a measurement, and the worst outcome for this feature is
// silencing one.
const GOAL_WORDS = [
  'цел', 'целта', 'цели',
  'целева', 'целеви', 'целево', 'целевата', 'целевия', 'целевият', 'целевото',
  'таргет', 'таргетна', 'таргетни', 'таргетно', 'таргетен',
  'поддържай', 'поддържайте', 'поддържане',
  'стреми', 'стремеж',
  'прицелна', 'прицелни', 'прицелен', 'прицелно',
];

// ascii-safe: this is built from the Cyrillic GOAL_WORDS above and uses \p{L}
// classes with the u flag — there is no \b or \w in it. The marker is here
// because the alternation is assembled at runtime and the guard reads source.
const GOAL_RE = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?:${GOAL_WORDS.join('|')})(?![\\p{L}\\p{N}_])`,
  'iu',
);

// A clause ends at punctuation or a line break. Deliberately coarse: a goal word
// and its vital sit in one clause in every real phrasing of this
// („Целева сатурация 88-92%"), so a tighter rule buys nothing and a looser one
// starts swallowing real measurements from the next sentence.
// ascii-safe: punctuation and whitespace only.
const CLAUSE_BOUNDARY = /[.,;:!?\n\r]/;

const GOAL_WORD_SET = new Set(GOAL_WORDS);

// ⚠ A COLON AFTER A GOAL WORD INTRODUCES ITS VALUE — it does not end the clause.
// „Цел: сатурация 88-92%" and „Стремеж: сатурация 88%" are ordinary dictation,
// and a plain boundary rule loses the goal word one character before it is
// needed. Found by this feature's own paired fixture, not by review.
//
// It is narrow on purpose: only a colon whose immediately-preceding token IS a
// goal word is transparent. A general „colons are not boundaries" rule would let
// „Целева сатурация 88-92%: днес 79%" silence the 79 — the leak this whole
// clause-scoping exists to prevent.
// ascii-safe: matches a run of letters via \p{L} with the u flag; no \b, no \w.
const TRAILING_WORD_RE = /([\p{L}]+)[\s]*$/u;

function goalWordEndsAt(text: string, colonIndex: number): boolean {
  const m = text.slice(0, colonIndex).match(TRAILING_WORD_RE);
  return !!m && GOAL_WORD_SET.has(m[1].toLowerCase());
}

/**
 * Does a goal word govern the vital starting at `index`?
 *
 * Exported so the gate can exercise the rule directly AND through
 * findHighlights — a suppression tested only at its own function is not tested
 * on the surface that renders.
 */
export function isGoalScoped(text: string, index: number): boolean {
  // Walk back to the start of the clause containing this vital.
  let start = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = text[i];
    if (!CLAUSE_BOUNDARY.test(ch)) continue;
    // „Цел:" — the colon introduces this goal's own value, so keep walking.
    if (ch === ':' && goalWordEndsAt(text, i)) continue;
    start = i + 1;
    break;
  }
  const clauseBefore = text.slice(start, index);
  GOAL_RE.lastIndex = 0;
  return GOAL_RE.test(clauseBefore);
}

function findVitalMatches(text: string): HighlightMatch[] {
  const out: HighlightMatch[] = [];
  for (const rule of VITAL_RULES) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(text))) {
      if (!startsAtWordStart(text, m.index) || !endsAtNumberBoundary(text, m)) {
        // Resume one character past the rejected start rather than past the
        // whole rejected span. Over a 40 000-string fuzz the two are currently
        // byte-identical — every pattern ends in a digit or trailing unit, so a
        // rejected span cannot swallow a following keyword — so this is
        // DEFENSIVE, not load-bearing today. Said plainly because the previous
        // wording asserted a hazard the grammar makes unreachable, and a comment
        // that cannot be shown to matter is decoration.
        //
        // `continue` is load-bearing, though: a refuter changed it to `break`
        // and every gate stayed green while "PLT 245, t 39.5" lost its fever.
        rule.pattern.lastIndex = m.index + 1;
        continue;
      }
      // A stated target is not a measurement — see the block above. Checked
      // AFTER the boundary tests so the index it reasons about is a real match.
      if (isGoalScoped(text, m.index)) {
        rule.pattern.lastIndex = m.index + 1;
        continue;
      }
      const cls = rule.classify(m);
      if (cls) {
        out.push({
          start: m.index,
          end: m.index + m[0].length,
          kind: cls.kind,
          raw: m[0],
          display: m[0], // vitals: render the matched text as-is
          label: rule.label,
          message: cls.message,
        });
      }
    }
  }
  return out;
}

// ── Uncertain-word markers ────────────────────────────────────
// Backend transcription wraps low-confidence words in [[...]]. We render
// the inner word with a Word-style underline; the brackets themselves are
// hidden in display but preserved in source so the doctor can correct them.

const UNCERTAIN_RE = /\[\[([^\[\]]+?)\]\]/g;

function findUncertainMatches(text: string): HighlightMatch[] {
  const out: HighlightMatch[] = [];
  UNCERTAIN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = UNCERTAIN_RE.exec(text))) {
    const inner = m[1];
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'uncertain',
      raw: m[0],
      display: inner,
      label: 'Несигурно разпознаване',
      message: `Транскрипцията не е сигурна за "${inner}". Натиснете Редактирай за корекция или Потвърди, ако е правилна.`,
    });
  }
  return out;
}

// ── Combined finder ──────────────────────────────────────────

export function findHighlights(text: string): HighlightMatch[] {
  if (!text) return [];
  const all = [...findVitalMatches(text), ...findUncertainMatches(text)];
  // Sort by start; drop overlaps (keep first encountered)
  all.sort((a, b) => a.start - b.start);
  const dedup: HighlightMatch[] = [];
  let lastEnd = -1;
  for (const m of all) {
    if (m.start >= lastEnd) {
      dedup.push(m);
      lastEnd = m.end;
    }
  }
  return dedup;
}

// Back-compat alias for code still importing the old name
export const findVitalMatches_compat = findVitalMatches;
