// МКБ-10 — full Bulgarian dataset (10,990 codes) from NCPHA.
// Source: https://ncpha.government.bg/index/301-mkb-10-...
// Loaded lazily from /mkb10.json on first picker open and cached.

export interface MkbChapter {
  range: string;
  name: string;
  fgColor: string;
  bgColor: string;
  textColor: string;
}

export type MkbRow = readonly [code: string, term: string, chapterIdx: number];

export const MKB_CHAPTERS: MkbChapter[] = [
  { range: 'A00-B99', name: 'Инфекциозни и паразитни болести',          fgColor: '#E24B4A', bgColor: '#FCEBEB', textColor: '#791F1F' },
  { range: 'C00-D48', name: 'Новообразувания',                          fgColor: '#7F77DD', bgColor: '#EEEDFE', textColor: '#3C3489' },
  { range: 'D50-D89', name: 'Болести на кръвта и кръвотворните органи', fgColor: '#A32D2D', bgColor: '#FCEBEB', textColor: '#501313' },
  { range: 'E00-E90', name: 'Болести на ендокринната система',          fgColor: '#EF9F27', bgColor: '#FAEEDA', textColor: '#633806' },
  { range: 'F00-F99', name: 'Психични и поведенчески разстройства',     fgColor: '#534AB7', bgColor: '#EEEDFE', textColor: '#26215C' },
  { range: 'G00-G99', name: 'Болести на нервната система',              fgColor: '#185FA5', bgColor: '#E6F1FB', textColor: '#042C53' },
  { range: 'H00-H59', name: 'Болести на окото',                         fgColor: '#0F6E56', bgColor: '#E1F5EE', textColor: '#04342C' },
  { range: 'H60-H95', name: 'Болести на ухото',                         fgColor: '#1D9E75', bgColor: '#E1F5EE', textColor: '#04342C' },
  { range: 'I00-I99', name: 'Болести на органите на кръвообращението',  fgColor: '#D85A30', bgColor: '#FAECE7', textColor: '#4A1B0C' },
  { range: 'J00-J99', name: 'Болести на дихателната система',           fgColor: '#378ADD', bgColor: '#E6F1FB', textColor: '#042C53' },
  { range: 'K00-K93', name: 'Болести на храносмилателната система',     fgColor: '#BA7517', bgColor: '#FAEEDA', textColor: '#412402' },
  { range: 'L00-L99', name: 'Болести на кожата и подкожната тъкан',     fgColor: '#639922', bgColor: '#EAF3DE', textColor: '#173404' },
  { range: 'M00-M99', name: 'Болести на костно-мускулната система',     fgColor: '#854F0B', bgColor: '#FAEEDA', textColor: '#412402' },
  { range: 'N00-N99', name: 'Болести на пикочо-половата система',       fgColor: '#0F6E56', bgColor: '#E1F5EE', textColor: '#04342C' },
  { range: 'O00-O99', name: 'Бременност, раждане и послеродов период',  fgColor: '#D4537E', bgColor: '#FBEAF0', textColor: '#4B1528' },
  { range: 'P00-P96', name: 'Перинатални състояния',                    fgColor: '#E85D04', bgColor: '#FAEEDA', textColor: '#412402' },
  { range: 'Q00-Q99', name: 'Вродени аномалии и хромозомни аберации',   fgColor: '#7C3AED', bgColor: '#EEEDFE', textColor: '#26215C' },
  { range: 'R00-R99', name: 'Симптоми и признаци, некласифицирани',     fgColor: '#5F5E5A', bgColor: '#F1EFE8', textColor: '#2C2C2A' },
  { range: 'S00-T98', name: 'Травми, отравяния и последици',            fgColor: '#854F0B', bgColor: '#FAEEDA', textColor: '#412402' },
  { range: 'V01-Y98', name: 'Външни причини за заболеваемост',          fgColor: '#444441', bgColor: '#F1EFE8', textColor: '#2C2C2A' },
  { range: 'Z00-Z99', name: 'Фактори, влияещи върху здравното състояние', fgColor: '#185FA5', bgColor: '#E6F1FB', textColor: '#042C53' },
  { range: 'U00-U99', name: 'Кодове за специални цели (COVID-19)',      fgColor: '#0EA5E9', bgColor: '#E0F2FE', textColor: '#082F49' },
];

// Pre-computed numeric range pairs for chapter lookup.
type RangePair = readonly [startLetter: string, startNum: number, endLetter: string, endNum: number, chapterIdx: number];

const CHAPTER_RANGES: RangePair[] = [
  ['A', 0,  'B', 99, 0],
  ['C', 0,  'D', 48, 1],
  ['D', 50, 'D', 89, 2],
  ['E', 0,  'E', 90, 3],
  ['F', 0,  'F', 99, 4],
  ['G', 0,  'G', 99, 5],
  ['H', 0,  'H', 59, 6],
  ['H', 60, 'H', 95, 7],
  ['I', 0,  'I', 99, 8],
  ['J', 0,  'J', 99, 9],
  ['K', 0,  'K', 93, 10],
  ['L', 0,  'L', 99, 11],
  ['M', 0,  'M', 99, 12],
  ['N', 0,  'N', 99, 13],
  ['O', 0,  'O', 99, 14],
  ['P', 0,  'P', 96, 15],
  ['Q', 0,  'Q', 99, 16],
  ['R', 0,  'R', 99, 17],
  ['S', 0,  'T', 98, 18],
  ['V', 1,  'Y', 98, 19],
  ['Z', 0,  'Z', 99, 20],
  ['U', 0,  'U', 99, 21],
];

function chapterFor(code: string): number {
  const m = code.match(/^([A-Z])(\d{1,3})/);
  if (!m) return 17; // default: Symptoms
  const letter = m[1];
  const num = parseInt(m[2], 10);
  for (const [sl, sn, el, en, idx] of CHAPTER_RANGES) {
    const afterStart = letter > sl || (letter === sl && num >= sn);
    const beforeEnd = letter < el || (letter === el && num <= en);
    if (afterStart && beforeEnd) return idx;
  }
  return 17;
}

// ── Lazy data loader ─────────────────────────────────────────

type RawRow = [string, string];

let _data: MkbRow[] | null = null;
let _loadPromise: Promise<MkbRow[]> | null = null;

export function getMkbDataSync(): MkbRow[] | null {
  return _data;
}

export async function loadMkb(): Promise<MkbRow[]> {
  if (_data) return _data;
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    try {
      const res = await fetch('/mkb10.json', { cache: 'force-cache' });
      if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }
      const raw = (await res.json()) as RawRow[];
      _data = raw.map(
        ([code, term]) => [code, term, chapterFor(code)] as MkbRow
      );
      return _data;
    } catch (e) {
      _loadPromise = null; // allow retry on next call
      throw e;
    }
  })();
  return _loadPromise;
}

// ── Synchronous helpers — take loaded data ───────────────────

export function searchMkb(
  data: MkbRow[],
  query: string,
  limit = 200
): MkbRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return data.slice(0, limit);
  const out: MkbRow[] = [];
  // Prefer code-prefix matches first, then term matches
  const codeMatches: MkbRow[] = [];
  const termMatches: MkbRow[] = [];
  for (const row of data) {
    if (row[0].toLowerCase().startsWith(q)) {
      codeMatches.push(row);
      if (codeMatches.length + termMatches.length >= limit) break;
    } else if (
      row[0].toLowerCase().includes(q) ||
      row[1].toLowerCase().includes(q)
    ) {
      termMatches.push(row);
      if (codeMatches.length + termMatches.length >= limit) break;
    }
  }
  out.push(...codeMatches, ...termMatches);
  return out;
}

export function rowsInChapter(data: MkbRow[], chapterIdx: number): MkbRow[] {
  return data.filter((r) => r[2] === chapterIdx);
}

export function chapterCounts(data: MkbRow[]): number[] {
  const counts = new Array(MKB_CHAPTERS.length).fill(0);
  for (const r of data) counts[r[2]]++;
  return counts;
}

export function findByCode(data: MkbRow[], code: string): MkbRow | undefined {
  return data.find((r) => r[0] === code);
}
