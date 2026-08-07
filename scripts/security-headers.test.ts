// Both origins must carry the same security headers. (F-01/F-02, 2026-08-07)
//
// The doctor's workspace is served by Next (this repo) and the phone recording
// page is served by EXPRESS (tubermed-backend routes/sessions.js mobilePage).
// Only one of them had headers. A sweep of the backend returned zero hits, and
// the comment at the top of next.config.ts recorded exactly that — "the phone
// /mobile-page is served by the BACKEND and needs its own CSP there — not
// covered here" — as a deferred tightening that was never followed up.
//
// The backend half is now asserted end-to-end over real HTTP against a real
// spawned server: tubermed-backend/scripts/test-security-headers.js. THIS file
// is the other half of that pair. It is a config-level assertion, deliberately:
// next.config.ts gates headers() on NODE_ENV === 'production', so asserting
// them over HTTP would need a full `next build && next start` on every test
// run. What it CAN do is make sure this origin never quietly loses a header the
// other one is being held to.
//
// Run: npm test   (node --test scripts/*.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const configSource = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');

// The set both origins are held to. Keep in step with the helmet configuration
// in tubermed-backend/server.js — if a header is added there, add it here.
const REQUIRED_HEADERS = [
  'Content-Security-Policy',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'X-Frame-Options',
  'Permissions-Policy',
  'Strict-Transport-Security',
];

test('next.config.ts ships every header the backend is also held to', () => {
  for (const header of REQUIRED_HEADERS) {
    assert.ok(
      configSource.includes(`"${header}"`),
      `${header} is missing from next.config.ts securityHeaders — the phone page ` +
      `now carries it (backend server.js helmet config); these two must not diverge`
    );
  }
});

test('the microphone permission survives — the scribe records', () => {
  // The one header whose REMOVAL breaks the product rather than weakening it.
  assert.match(configSource, /microphone=\(self\)/);
});

test('the mobile-page CSP gap is recorded as CLOSED, not as a deferred item', () => {
  // The gap existed for months because the note describing it read as a plan.
  // A stale "not covered here" here means someone reading this file will
  // believe the phone page is still unprotected — or, worse, that leaving a
  // backend surface unprotected is the accepted state.
  const staleNote = /needs its own CSP there — not covered here/;
  assert.ok(
    !staleNote.test(configSource),
    'next.config.ts still describes the backend mobile page as uncovered; it now ' +
    'ships its own nonce-based CSP (tubermed-backend/server.js) — update the note'
  );
});
