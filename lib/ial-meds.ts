// IAL meds — 1028 INN-level entries from the Bulgarian Drug Agency register
// (March 2026). Loaded lazily from /ial-inns.json on first picker open.

import { normalizeLatin, searchCandidates } from './translit';

export interface IalEntry {
  i: string;                          // INN (Latin)
  b: string;                          // Bulgarian transliteration
  a: string;                          // ATC code
  r: boolean;                         // requires Rx
  fd: Record<string, string[]>;       // form → list of doses for that form
  t: string[];                        // brand-word aliases
}

let _data: IalEntry[] | null = null;
let _loadPromise: Promise<IalEntry[]> | null = null;
let _searchIndex: { inn: string; brands: string[] }[] | null = null;

function buildIndex(data: IalEntry[]): void {
  _searchIndex = data.map((e) => ({
    inn: normalizeLatin(e.i),
    brands: e.t.map((b) => normalizeLatin(b)),
  }));
}

// Normalize each entry to guarantee shape regardless of what the JSON
// contained — survives older schemas or partial data.
function normalizeEntry(raw: Partial<IalEntry>): IalEntry {
  return {
    i: raw.i || '',
    b: raw.b || raw.i || '',
    a: raw.a || '',
    r: raw.r !== false, // default true (Rx) when missing — safer
    fd: raw.fd && typeof raw.fd === 'object' ? raw.fd : {},
    t: Array.isArray(raw.t) ? raw.t : [],
  };
}

export function getIalDataSync(): IalEntry[] | null {
  return _data;
}

export async function loadIal(): Promise<IalEntry[]> {
  if (_data) return _data;
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    try {
      // No `force-cache` — HTTP caching is enough and avoids serving
      // stale JSON after schema updates during development.
      const res = await fetch('/ial-inns.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const raw = (await res.json()) as Partial<IalEntry>[];
      _data = raw.map(normalizeEntry).filter((e) => e.i.length > 0);
      buildIndex(_data);
      return _data;
    } catch (e) {
      _loadPromise = null;
      throw e;
    }
  })();
  return _loadPromise;
}

// ── Search ────────────────────────────────────────────────────

export interface SearchHit {
  entry: IalEntry;
  matchKind: 'inn-prefix' | 'inn-contains' | 'brand';
}

export function searchIal(query: string, limit = 200): SearchHit[] {
  if (!_data || !_searchIndex) return [];
  const cands = searchCandidates(query);
  if (cands.length === 0) {
    return _data.slice(0, limit).map((entry) => ({
      entry,
      matchKind: 'inn-prefix' as const,
    }));
  }

  const prefixHits: SearchHit[] = [];
  const containsHits: SearchHit[] = [];
  const brandHits: SearchHit[] = [];

  for (let i = 0; i < _data.length; i++) {
    const idx = _searchIndex[i];
    let added = false;
    for (const c of cands) {
      if (idx.inn.startsWith(c)) {
        prefixHits.push({ entry: _data[i], matchKind: 'inn-prefix' });
        added = true;
        break;
      }
    }
    if (added) continue;

    for (const c of cands) {
      if (idx.inn.includes(c)) {
        containsHits.push({ entry: _data[i], matchKind: 'inn-contains' });
        added = true;
        break;
      }
    }
    if (added) continue;

    for (const c of cands) {
      if (idx.brands.some((b) => b.startsWith(c) || b.includes(c))) {
        brandHits.push({ entry: _data[i], matchKind: 'brand' });
        added = true;
        break;
      }
    }

    if (prefixHits.length + containsHits.length + brandHits.length >= limit) {
      break;
    }
  }

  return [...prefixHits, ...containsHits, ...brandHits].slice(0, limit);
}

export function findInn(inn: string): IalEntry | undefined {
  if (!_data) return undefined;
  return _data.find((e) => e.i === inn);
}

// Total dose count across all forms — proxy for "common drug" sort.
// Defensive against missing or malformed fd.
export function totalOptions(e: IalEntry): number {
  if (!e || !e.fd || typeof e.fd !== 'object') return 0;
  let n = 0;
  for (const k of Object.keys(e.fd)) {
    const arr = e.fd[k];
    if (Array.isArray(arr)) n += arr.length;
  }
  return n;
}
