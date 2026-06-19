// Settings→sidebar identity propagation (facet A: persist) — lib/api.ts.
//
// When the doctor saves Профил (Име / Специалност / Място на работа), the updated
// identity must be merged back into the stored session so a page reload keeps the
// sidebar correct (the live facet is React context, tested only via tsc/build).
//
//   mergeSessionDoctor(session, partial) — PURE: returns a new Session with the
//     partial shallow-merged onto session.doctor; token + unlisted doctor fields
//     preserved; input never mutated.
//   updateSessionDoctor(partial)        — reads the current session, merges, and
//     RE-PERSISTS to the SAME storage it currently lives in (preserving "Запомни
//     ме" — never flipping localStorage↔sessionStorage), preserving the token;
//     no-ops when there is no session.
//
// A minimal in-memory Storage polyfill exercises the storage round-trip under tsx
// (no jsdom). Pure, offline. Run: npx tsx scripts/session-doctor.ts (exit 0/1).

import {
  getSession,
  setSession,
  updateSessionDoctor,
  mergeSessionDoctor,
  type Session,
} from '../lib/api';

// ── In-memory Storage polyfill (api.ts reads window/localStorage/sessionStorage
//    as globals at CALL time; lib/api top-level touches none of them at import) ─
class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
  key(i: number): string | null { return Array.from(this.m.keys())[i] ?? null; }
}
const g = globalThis as unknown as {
  window?: unknown;
  localStorage: MemStorage;
  sessionStorage: MemStorage;
};
g.window = g.window ?? {};
g.localStorage = new MemStorage();
g.sessionStorage = new MemStorage();

const STORAGE_KEY = 'tuber_auth';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ ${msg}`); failed++; }
}

const baseSession: Session = {
  token: 'jwt-abc.def.ghi',
  doctor: {
    id: 'doc-1',
    name: 'д-р Мария Иванова',
    specialty: 'Кардиология',
    organizationName: 'АИППМП Здраве',
  },
};

// ── mergeSessionDoctor: pure merge ───────────────────────────────────────────
console.log('\nTest 1: mergeSessionDoctor merges the partial, preserves token + other doctor fields');
{
  const merged = mergeSessionDoctor(baseSession, { specialty: 'Неврология' });
  assert(merged.doctor.specialty === 'Неврология', 'specialty updated from the partial');
  assert(merged.doctor.name === 'д-р Мария Иванова', 'name preserved (not in partial)');
  assert(merged.doctor.id === 'doc-1', 'id preserved');
  assert(merged.doctor.organizationName === 'АИППМП Здраве', 'organizationName preserved (not in partial)');
  assert(merged.token === 'jwt-abc.def.ghi', 'token preserved');
}

console.log('\nTest 2: mergeSessionDoctor applies a multi-field partial (name + org)');
{
  const merged = mergeSessionDoctor(baseSession, { name: 'д-р Петър Петров', organizationName: 'МЦ Витоша' });
  assert(merged.doctor.name === 'д-р Петър Петров', 'name updated');
  assert(merged.doctor.organizationName === 'МЦ Витоша', 'organizationName updated');
  assert(merged.doctor.specialty === 'Кардиология', 'specialty preserved (not in partial)');
}

console.log('\nTest 3: mergeSessionDoctor does not mutate its input (immutability)');
{
  const input: Session = { token: 't', doctor: { id: 'i', name: 'n', specialty: 's', organizationName: 'o' } };
  const merged = mergeSessionDoctor(input, { specialty: 'CHANGED' });
  assert(input.doctor.specialty === 's', 'original session.doctor untouched');
  assert(merged !== input, 'returns a new session object');
  assert(merged.doctor !== input.doctor, 'returns a new doctor object');
}

// ── updateSessionDoctor: storage round-trip, "Запомни ме" preserved ──────────
console.log('\nTest 4: updateSessionDoctor persists the merge to localStorage when remembered');
{
  g.localStorage.clear(); g.sessionStorage.clear();
  setSession(baseSession, true);                     // remember → localStorage
  updateSessionDoctor({ specialty: 'Ендокринология', organizationName: 'ДКЦ 1' });
  const s = getSession()!;
  assert(s.doctor.specialty === 'Ендокринология', 'specialty persisted');
  assert(s.doctor.organizationName === 'ДКЦ 1', 'organizationName persisted');
  assert(s.doctor.name === baseSession.doctor.name, 'name preserved');
  assert(s.token === baseSession.token, 'token preserved');
  assert(g.localStorage.getItem(STORAGE_KEY) !== null, 'stays in localStorage');
  assert(g.sessionStorage.getItem(STORAGE_KEY) === null, 'did NOT leak into sessionStorage (remember preserved)');
}

console.log('\nTest 5: updateSessionDoctor preserves sessionStorage when NOT remembered');
{
  g.localStorage.clear(); g.sessionStorage.clear();
  setSession(baseSession, false);                    // not remembered → sessionStorage
  updateSessionDoctor({ name: 'д-р Нов' });
  const s = getSession()!;
  assert(s.doctor.name === 'д-р Нов', 'name persisted');
  assert(g.sessionStorage.getItem(STORAGE_KEY) !== null, 'stays in sessionStorage');
  assert(g.localStorage.getItem(STORAGE_KEY) === null, 'did NOT promote to localStorage (remember=false preserved)');
}

console.log('\nTest 6: updateSessionDoctor no-ops without a session');
{
  g.localStorage.clear(); g.sessionStorage.clear();
  updateSessionDoctor({ specialty: 'X' });           // no session present
  assert(getSession() === null, 'still no session (no-op)');
  assert(g.localStorage.getItem(STORAGE_KEY) === null, 'nothing written to localStorage');
  assert(g.sessionStorage.getItem(STORAGE_KEY) === null, 'nothing written to sessionStorage');
}

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
