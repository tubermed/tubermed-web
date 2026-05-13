// IAL meds — 1028 INN-level entries from the Bulgarian Drug Agency register
// (March 2026). Loaded lazily from /ial-inns.json on first picker open.

import { normalizeLatin, searchCandidates } from './translit';

// Compact entry shape (matches /ial-inns.json keys)
export interface IalEntry {
  i: string;     // INN (Latin)
  b: string;     // Bulgarian transliteration
  a: string;     // ATC code
  r: boolean;    // requires Rx (true = prescription)
  f: string[];   // available forms (BG)
  d: string[];   // available doses
  t: string[];   // trade-name aliases
}

let _data: IalEntry[] | null = null;
let _loadPromise: Promise<IalEntry[]> | null = null;

// Pre-computed normalized search field for each entry, built lazily after load.
let _searchIndex: { inn: string; trades: string[] }[] | null = null;

function buildIndex(data: IalEntry[]): void {
  _searchIndex = data.map((e) => ({
    inn: normalizeLatin(e.i),
    trades: e.t.map((t) => normalizeLatin(t)),
  }));
}

export function getIalDataSync(): IalEntry[] | null {
  return _data;
}

export async function loadIal(): Promise<IalEntry[]> {
  if (_data) return _data;
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    try {
      const res = await fetch('/ial-inns.json', { cache: 'force-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const raw = (await res.json()) as IalEntry[];
      _data = raw;
      buildIndex(raw);
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
  matchKind: 'inn-prefix' | 'inn-contains' | 'trade';
}

export function searchIal(query: string, limit = 200): SearchHit[] {
  if (!_data || !_searchIndex) return [];
  const cands = searchCandidates(query);
  if (cands.length === 0) {
    // Empty query → return common drugs (alphabetical)
    return _data.slice(0, limit).map((entry) => ({
      entry,
      matchKind: 'inn-prefix' as const,
    }));
  }

  const prefixHits: SearchHit[] = [];
  const containsHits: SearchHit[] = [];
  const tradeHits: SearchHit[] = [];

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
      if (idx.trades.some((t) => t.includes(c))) {
        tradeHits.push({ entry: _data[i], matchKind: 'trade' });
        added = true;
        break;
      }
    }

    if (prefixHits.length + containsHits.length + tradeHits.length >= limit) {
      break;
    }
  }

  return [...prefixHits, ...containsHits, ...tradeHits].slice(0, limit);
}

export function findInn(inn: string): IalEntry | undefined {
  if (!_data) return undefined;
  return _data.find((e) => e.i === inn);
}
