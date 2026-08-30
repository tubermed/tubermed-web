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
  ) => { kind: 'vital-warn' | 'vital-critical'; message: string; dataSanity?: boolean } | null;
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
          // A TRANSCRIPTION-ERROR verdict, not a clinical range — never suppressed
          // by a goal word (a target cannot be an inverted reading).
          dataSanity: true,
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
// Exported so the gate can pin it by exact content. A refuter added 'до' and
// 'за' to this list and every gate stayed green while essentially every vital in
// the corpus went silent — the list was referenced by no test at all.
export const GOAL_WORDS = [
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

// ── ⚠ THE FIRST CUT OF THIS RULE SWALLOWED REAL HYPOXAEMIA ──────────────────
// A fresh-context refuter ran ~6,490 candidate sentences against the original
// „clause = punctuation" scoping and found the dangerous direction wide open.
// Every one of these was SILENT — verified by hand before this rewrite:
//
//   „…целева сатурация 88-92% но при постъпване сатурация 79%"   (no comma before „но")
//   „Цел сатурация 88-92% — при постъпване сатурация 79%"        (em dash)
//   „Целева сатурация 88-92%\tАктуална сатурация 79%"            (TAB)
//   „Целево АН под 140/90 но при постъпване АН 195/120"          (hypertensive crisis)
//   „Целта на лечението е ремисия … сатурация 79%"               (goal governs something else)
//   „Пациентът не постигна целта: сатурация 79%"                 (colon exemption, backward)
//   „Целево АН 130/80 при контрола АН 60/90"                     (a TRANSCRIPTION-ERROR check)
//
// 40 of 48 tested separators leaked: every Bulgarian coordinating conjunction
// used without a comma (но, а, обаче, докато, като), every dash, every bracket,
// and EVERY whitespace character except \n and \r. Dictated Bulgarian drops the
// comma before „но" routinely and ASR punctuation is not reliable enough to be
// load-bearing for a SAFETY suppression. The old comment claimed a goal word and
// its vital „sit in one clause in every real phrasing" — true of the target
// phrasing, and it says nothing about the reading that follows it.
//
// ── The rule is now NEAREST-GOVERNOR, not clause-membership ──────────────────
// A goal word governs a vital only if it is the nearest thing that could govern
// it. Walking back from the vital, the FIRST of these ends the goal's reach:
//
//   • a clause boundary (now including dashes, brackets, slashes and bullets)
//   • ANOTHER VITAL KEYWORD — „целева сатурация 88-92% … сатурация 79%": the
//     first reading is what the target governs, the second is a new measurement
//   • a coordinating conjunction — „но", „а", „обаче" start a new assertion
//   • more than MAX_GOAL_DISTANCE_TOKENS words of distance
//
// The token distance is the backstop for everything the character rules miss:
// Measured against the real phrasings rather than guessed: „Поддържане НА
// сатурация" is one word, „Стреми СЕ КЪМ сатурация" is two. Two is the most any
// legitimate target needs — and a bound of four still let
// „Прегледът цели уточняване на диагнозата ЧСС 168" through, which is a real
// tachycardia behind a goal word governing something else entirely.
const MAX_GOAL_DISTANCE_TOKENS = 2;

// ascii-safe: punctuation, whitespace and dashes only — no \b, no \w.
// Widened from /[.,;:!?\n\r]/ after the refuter round: an em dash, a bracket, a
// slash and a bullet all separate two readings in real dictation.
const CLAUSE_BOUNDARY = /[.,;:!?\n\r\t\v\f\u0085\u00A0\u2028\u2029\u202F()\[\]{}|\/\\\u2022\u00B7\u2026\u2014\u2013\u2212-]/;

// Coordinating conjunctions END a goal's reach: what follows is a new assertion,
// not part of the target. „целева сатурация 88-92% НО сатурация 79%" is the
// founding case, and Bulgarian dictation routinely omits the comma before them.
const CONJUNCTIONS = new Set([
  'но', 'а', 'обаче', 'ала', 'ама', 'пък', 'докато', 'като', 'въпреки',
  'и', 'или', 'при', 'днес', 'актуална', 'актуално', 'актуален',
]);

const GOAL_WORD_SET = new Set(GOAL_WORDS);

// ⚠ NARROWED after the refuter round. The old rule asked only „is the token
// before the colon a goal word?", which made the colon transparent in
// „Пациентът НЕ ПОСТИГНА целта: сатурация 79%" — and then found „целта" behind
// it and swallowed a real hypoxaemia. The colon there introduces the MEASURED
// RESULT, not a target.
//
// A colon is transparent only when the whole clause before it is a bare goal
// PHRASE: at most two words, the last of which is a goal word. „Цел:" and
// „Терапевтична цел:" qualify; „Пациентът не постигна целта:" (four words) and
// „Далеч сме от целта:" do not.
const MAX_GOAL_PHRASE_WORDS = 2;

function colonIsGoalIntroducer(text: string, colonIndex: number): boolean {
  // The clause immediately before this colon, bounded by the previous boundary.
  let start = 0;
  for (let i = colonIndex - 1; i >= 0; i--) {
    if (CLAUSE_BOUNDARY.test(text[i]) && text[i] !== ' ') { start = i + 1; break; }
  }
  const words = text.slice(start, colonIndex).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > MAX_GOAL_PHRASE_WORDS) return false;
  const last = words[words.length - 1].replace(/[^\p{L}]/gu, '').toLowerCase();
  return GOAL_WORD_SET.has(last);
}

/**
 * Does a goal word GOVERN the vital starting at `index`?
 *
 * Nearest-governor, not clause-membership — see the block above for the seven
 * real sentences the clause-membership version swallowed.
 *
 * `vitalStarts` is every other vital match in the same text. An intervening
 * vital keyword ends a goal's reach: in „целева сатурация 88-92% … сатурация
 * 79%" the target governs the FIRST reading, and the second is a new
 * measurement. Passing it in (rather than re-scanning) is what makes this
 * decidable at all — the character rules alone cannot see it.
 *
 * Exported so the gate can exercise the rule directly AND through
 * findHighlights — a suppression tested only at its own function is not tested
 * on the surface that renders.
 */
export function isGoalScoped(text: string, index: number, vitalStarts: number[] = []): boolean {
  // 1 · walk back to the nearest hard boundary.
  let start = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = text[i];
    if (!CLAUSE_BOUNDARY.test(ch) || ch === ' ') continue;
    if (ch === ':' && colonIsGoalIntroducer(text, i)) continue;
    start = i + 1;
    break;
  }
  const before = text.slice(start, index);

  // 2 · the LAST goal word in that window, if any.
  let lastGoalEnd = -1;
  let lastGoalStart = -1;
  const scan = new RegExp(GOAL_RE.source, 'giu');
  let g: RegExpExecArray | null;
  while ((g = scan.exec(before))) { lastGoalStart = g.index; lastGoalEnd = g.index + g[0].length; }
  if (lastGoalEnd === -1) return false;

  const between = before.slice(lastGoalEnd);

  // 3 · a coordinating conjunction after the goal word starts a new assertion.
  for (const w of between.toLowerCase().split(/[^\p{L}]+/u)) {
    if (w && CONJUNCTIONS.has(w)) return false;
  }

  // 4 · another vital keyword between the goal word and this one — the goal
  //     governs that first reading, not this one.
  const goalAbs = start + lastGoalStart;
  for (const s of vitalStarts) {
    if (s > goalAbs && s < index) return false;
  }

  // 5 · distance backstop for whatever rules 1-4 miss.
  const words = between.split(/\s+/).filter(Boolean);
  return words.length <= MAX_GOAL_DISTANCE_TOKENS;
}

function findVitalMatches(text: string): HighlightMatch[] {
  // ── PASS 1 · every boundary-valid candidate, across ALL rules ──────────────
  // Collected before anything is classified, because the goal-suppression needs
  // to know where the OTHER vitals are: „целева сатурация 88-92% … сатурация
  // 79%" is only decidable if the second reading can see the first. A per-rule
  // loop that classified as it went could not see across rules either
  // („Целево АН 130/80 … ЧСС 168").
  type Candidate = { rule: VitalRule; m: RegExpExecArray };
  const candidates: Candidate[] = [];
  for (const rule of VITAL_RULES) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(text))) {
      if (!startsAtWordStart(text, m.index) || !endsAtNumberBoundary(text, m)) {
        // Resume one character past the rejected start rather than past the
        // whole rejected span. `continue` is load-bearing: a refuter changed it
        // to `break` and every gate stayed green while "PLT 245, t 39.5" lost
        // its fever.
        rule.pattern.lastIndex = m.index + 1;
        continue;
      }
      candidates.push({ rule, m });
      rule.pattern.lastIndex = m.index + m[0].length;
    }
  }
  const vitalStarts = candidates.map((c) => c.m.index).sort((a, b) => a - b);

  // ── PASS 2 · classify, then decide suppression ─────────────────────────────
  const out: HighlightMatch[] = [];
  for (const { rule, m } of candidates) {
    const cls = rule.classify(m);
    if (!cls) continue;
    // ⚠ A DATA-SANITY verdict is never suppressed. `systolic <= diastolic` is a
    // TRANSCRIPTION-ERROR detector, not a clinical range: a stated target can
    // never be an inverted reading, so a goal word in front of it says nothing.
    // „Целево АН 130/80 при контрола АН 60/90" hid exactly that.
    if (!cls.dataSanity && isGoalScoped(text, m.index, vitalStarts)) continue;
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
