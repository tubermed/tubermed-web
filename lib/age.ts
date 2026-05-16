// Age computation from an ISO 'YYYY-MM-DD' birth date. Returns null on parse failure.
export function ageFromBirthDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const by = parseInt(m[1], 10);
  const bm = parseInt(m[2], 10);
  const bd = parseInt(m[3], 10);
  const today = new Date();
  let age = today.getFullYear() - by;
  if (
    today.getMonth() + 1 < bm ||
    (today.getMonth() + 1 === bm && today.getDate() < bd)
  ) age--;
  return age >= 0 ? age : null;
}
