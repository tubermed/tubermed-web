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
