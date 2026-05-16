// Client-side ЕГН helpers. Format check + DOB/gender derivation only —
// the backend owns the authoritative validation (including the soft checksum).
// We use these for live form feedback (auto-fill Възраст from typed ЕГН).

export function isValidEgnFormat(plain: string): boolean {
  return /^\d{10}$/.test(plain);
}

// Returns ISO date 'YYYY-MM-DD' or null if the encoded date is invalid.
export function dobFromEgn(plain: string): string | null {
  if (!isValidEgnFormat(plain)) return null;
  let yy = parseInt(plain.slice(0, 2), 10);
  let mm = parseInt(plain.slice(2, 4), 10);
  let dd = parseInt(plain.slice(4, 6), 10);
  let century = 1900;
  if (mm >= 41 && mm <= 52)      { century = 2000; mm -= 40; }
  else if (mm >= 21 && mm <= 32) { century = 1800; mm -= 20; }
  const year = century + yy;
  const dob = new Date(Date.UTC(year, mm - 1, dd));
  if (
    dob.getUTCFullYear() !== year ||
    dob.getUTCMonth() !== mm - 1 ||
    dob.getUTCDate() !== dd
  ) return null;
  return dob.toISOString().slice(0, 10);
}

// 9th digit even → male, odd → female. Matches Bulgarian ЕГН convention.
export function genderFromEgn(plain: string): 'male' | 'female' | null {
  if (!isValidEgnFormat(plain)) return null;
  return parseInt(plain[8], 10) % 2 === 0 ? 'male' : 'female';
}
