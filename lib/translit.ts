// Cyrillic ↔ Latin transliteration for medical drug-name search.
// Bulgarian doctors freely mix alphabets. To make search work either way,
// we normalize the query into BOTH alphabets and try to match against
// data that's stored in Latin.

// ── Detection ─────────────────────────────────────────────────

const CYRILLIC_RE = /[\u0400-\u04FF]/;

export function isCyrillic(s: string): boolean {
  return CYRILLIC_RE.test(s);
}

// ── Cyrillic → Latin ──────────────────────────────────────────
// Conservative phonetic mapping. Maps both common variants (с/з → s/z)
// so a Bulgarian query can match Latin data regardless of which letter
// the medical convention uses.

const CYR_TO_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch',
  ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
};

export function cyrToLat(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) {
    out += CYR_TO_LAT[ch] ?? ch;
  }
  return out;
}

// ── Normalization for fuzzy match ─────────────────────────────
// Collapse common Latin variants that map to the same Cyrillic letter
// so the search hits regardless of which spelling the doctor used.

export function normalizeLatin(s: string): string {
  let n = s.toLowerCase();
  // Bulgarian medical convention often uses both s and z between vowels
  // for the same drug (lisinopril / lizinopril). Map both to 's' so they
  // collapse for matching.
  n = n.replace(/z/g, 's');
  // c/k often interchangeable
  n = n.replace(/k/g, 'c');
  // ph → f (some Bulgarian transliterations write Latin "phenol" or "fenol")
  n = n.replace(/ph/g, 'f');
  // y/i collapse
  n = n.replace(/y/g, 'i');
  // collapse double consonants
  n = n.replace(/([bcdfghjklmnpqrstvwxz])\1/g, '$1');
  return n;
}

// ── Search candidates ────────────────────────────────────────
// Given a user query in any alphabet, return all Latin variants worth
// trying against the data.

export function searchCandidates(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out = new Set<string>();
  out.add(normalizeLatin(q));
  if (isCyrillic(q)) {
    out.add(normalizeLatin(cyrToLat(q)));
  }
  return [...out].filter(Boolean);
}
