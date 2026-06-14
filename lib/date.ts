// Bulgarian date formatting — the single source of truth for how the workspace
// renders dates, so we never drift between ad-hoc per-component formatters.
// Date-only values (birth dates, a day's schedule) go through formatDateBg;
// full timestamps (a consultation's created_at) go through formatDateTimeBg.
// Both defensively return '' on empty / unparseable input (mirrors lib/age.ts)
// so a raw ISO string can never leak into the UI.

/** ISO `YYYY-MM-DD` → `DD.MM.YYYY`. Returns '' on empty / malformed input. */
export function formatDateBg(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/**
 * ISO timestamp → `DD.MM.YYYY · HH:MM` in Europe/Sofia. Returns '' on empty /
 * unparseable input. Used for `created_at`-style timestamps that carry a time.
 */
export function formatDateTimeBg(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = new Intl.DateTimeFormat('bg-BG', {
    timeZone: 'Europe/Sofia',
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d);
  const time = new Intl.DateTimeFormat('bg-BG', {
    timeZone: 'Europe/Sofia',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
  return `${date} · ${time}`;
}

/**
 * Today's date in Europe/Sofia as ISO `YYYY-MM-DD`. Mirrors lib/egn.ts
 * dobFromEgn's convention (`en-CA` → ISO-shaped) so manual-DOB checks and ЕГН
 * decoding agree on what "today" is (a baby registered first thing in the
 * morning isn't flagged just because UTC hasn't ticked over).
 */
export function todaySofiaIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(new Date());
}

/**
 * True when `iso` is a well-formed `YYYY-MM-DD` AND a real calendar day — it
 * round-trips through Date, so 2025-02-30 / month 13 / day 00 are rejected.
 * Mirrors the round-trip check dobFromEgn uses on the ЕГН-decoded date.
 */
export function isRealIsoDate(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * True when `iso` is strictly after today (Europe/Sofia). ISO `YYYY-MM-DD`
 * strings collate chronologically, so a lexical compare is a date compare.
 */
export function isFutureIsoDate(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return iso > todaySofiaIso();
}

/**
 * Validate a (manually entered) birth date. Returns `null` for empty or a real,
 * past date; 'invalid' for a non-real calendar day; 'future' for a real date
 * after today. Empty is intentionally OK — birth_date stays optional.
 */
export function dobError(iso: string | null | undefined): 'invalid' | 'future' | null {
  if (!iso) return null;
  if (!isRealIsoDate(iso)) return 'invalid';
  if (isFutureIsoDate(iso)) return 'future';
  return null;
}

/**
 * ISO `YYYY-MM-DD` → masked `ДД.ММ.ГГГГ` display text ('' if empty / malformed).
 * The masked display format IS formatDateBg's output, reused so the two never
 * drift.
 */
export function isoToBgInput(iso: string | null | undefined): string {
  return formatDateBg(iso);
}

/**
 * Masked `DD.MM.YYYY` (or 8 raw digits) → ISO `YYYY-MM-DD`. INCOMPLETE input
 * (fewer than 8 digits) emits '' so the age readout + DOB validation don't
 * flicker mid-typing. A COMPLETE 8-digit date emits its ISO even when the day is
 * impossible (e.g. 31.02) — deliberately: dobError is the single validator that
 * flags 'invalid' / 'future' and blocks submit, so a mistyped date surfaces an
 * explicit error instead of silently failing to register (a DOB-loss hazard in a
 * clinical record). Format only — realness checking lives in dobError.
 */
export function bgInputToIso(text: string | null | undefined): string {
  if (!text) return '';
  const digits = text.replace(/\D/g, '');
  if (digits.length !== 8) return '';
  return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
}
