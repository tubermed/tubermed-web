// Per-doctor pinned МКБ-10 codes — localStorage-backed.
// Migration path: when the doctor has multiple devices or a clinic-shared
// favourites list is needed, move to a Supabase doctor_mkb_pins table.

const STORAGE_KEY = 'tuber_mkb_pinned';

export function getPinned(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((c): c is string => typeof c === 'string');
  } catch {
    return [];
  }
}

function writePinned(codes: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(codes));
  } catch {
    // Quota or privacy mode — silent fail; pins won't persist but UI still works
  }
}

export function isPinned(code: string): boolean {
  return getPinned().includes(code);
}

export function togglePin(code: string): string[] {
  const current = getPinned();
  const idx = current.indexOf(code);
  if (idx >= 0) {
    const next = [...current.slice(0, idx), ...current.slice(idx + 1)];
    writePinned(next);
    return next;
  }
  const next = [...current, code];
  writePinned(next);
  return next;
}

export function clearPinned(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
