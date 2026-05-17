// Client-side ЕГН helpers. Format check + DOB/gender derivation only —
// the backend owns the authoritative validation (including the soft checksum).
// We use these for live form feedback (auto-fill Възраст from typed ЕГН).

export function isValidEgnFormat(plain: string): boolean {
  return /^\d{10}$/.test(plain);
}

// Returns ISO date 'YYYY-MM-DD' for the encoded birth date, or null when
// the ЕГН can't be a real birth date for a living patient:
//   - format wrong (handled by isValidEgnFormat)
//   - digits 1–6 don't form a real calendar day (e.g. month 52 → dec, OK;
//     month 13 → invalid)
//   - decoded date is in the future (can't be born tomorrow)
// "Today" uses Europe/Sofia local date — same convention the backend uses for
// consultations_today — so a baby registered first thing in the morning isn't
// flagged just because UTC hasn't ticked over yet.
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
  const iso = dob.toISOString().slice(0, 10);
  // Future-date guard — ISO strings collate chronologically so > is safe.
  const todaySofia = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(new Date());
  if (iso > todaySofia) return null;
  return iso;
}

// 9th digit even → male, odd → female. Matches Bulgarian ЕГН convention.
export function genderFromEgn(plain: string): 'male' | 'female' | null {
  if (!isValidEgnFormat(plain)) return null;
  return parseInt(plain[8], 10) % 2 === 0 ? 'male' : 'female';
}
