// Highlight rules for Bulgarian clinical text:
//   - vital-sign detection (temperature, BP, HR, SpO2, ДЧ) with normal-range
//     classification
//   - blood-pressure data sanity (systolic ≤ diastolic → critical)
//   - low-confidence transcription markers (text wrapped in [[...]])

export type HighlightKind =
  | 'vital-warn'
  | 'vital-critical'
  | 'uncertain';

export interface HighlightMatch {
  start: number;       // position in source text
  end: number;
  kind: HighlightKind;
  raw: string;         // source text actually matched (incl. any [[...]])
  display: string;     // what to render inside the highlight (e.g. inner word, no brackets)
  label: string;       // short category label e.g. "Температура"
  message: string;     // human-readable reason
}

function parseDecimal(s: string): number {
  return parseFloat(s.replace(',', '.'));
}

// ── Vital rules ───────────────────────────────────────────────

interface VitalRule {
  category: string;
  label: string;
  pattern: RegExp;
  classify: (
    m: RegExpExecArray
  ) => { kind: 'vital-warn' | 'vital-critical'; message: string } | null;
}

const VITAL_RULES: VitalRule[] = [
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

function findVitalMatches(text: string): HighlightMatch[] {
  const out: HighlightMatch[] = [];
  for (const rule of VITAL_RULES) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(text))) {
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
