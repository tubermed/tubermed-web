// ─────────────────────────────────────────────────────────────────────────────
// lib/csp.ts — the connect-src contract, pinned.
// ─────────────────────────────────────────────────────────────────────────────
// Run: npm run test   (node --test, Node 24 strips the types natively.)
//
// WHY THIS FILE EXISTS: a connect-src miss is invisible everywhere except a
// live production browser. The Node tests inject fake sockets, next dev ships
// no CSP at all (prod-only headers), and the build succeeds regardless — so
// when the Soniox realtime origin was missing, every offline gate stayed green
// while every real streamed visit had its websocket refused at open() and
// degraded to the async path. These assertions make that class of regression a
// test failure instead of a clinic-only incident: every origin the app
// actually dials must be present, and nothing beyond the EU set may appear.

import { test } from 'node:test';
import assert from 'node:assert';
import Module from 'node:module';

// lib/csp.ts imports ./sentry-csp extensionless (the app bundler resolves it;
// plain `node --test` cannot) — same local resolve hook as
// exporters-section-text.test.ts, no app code or tsconfig change.
type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = Module as unknown as {
  registerHooks: (hooks: {
    resolve: (specifier: string, context: unknown, nextResolve: NextResolve) => unknown;
  }) => void;
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !specifier.endsWith('.ts')) {
        return nextResolve(specifier + '.ts', context);
      }
      throw err;
    }
  },
});

const { contentSecurityPolicy, backendConnectOrigins, SONIOX_RT_CONNECT_ORIGIN } =
  await import('../lib/csp.ts');

// The env the Vercel prod build sees (shape-wise): an https backend origin.
// Set BEFORE calling the builder — backendConnectOrigins() reads it per call.
const PROD_LIKE_BACKEND = 'https://tubermed-backend.example.up.railway.app';

function connectSrcEntries(policy: string): string[] {
  const directive = policy
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith('connect-src '));
  assert.ok(directive, 'the policy must carry a connect-src directive');
  return directive.replace(/^connect-src\s+/, '').split(/\s+/);
}

test('connect-src carries every origin the app actually dials', () => {
  process.env.NEXT_PUBLIC_BACKEND_URL = PROD_LIKE_BACKEND;
  const entries = connectSrcEntries(contentSecurityPolicy());

  assert.ok(entries.includes("'self'"), 'same-origin fetches');
  assert.ok(
    entries.includes('https://tubermed-backend.example.up.railway.app'),
    'the backend REST origin (lib/api.ts request())',
  );
  assert.ok(
    entries.includes('wss://tubermed-backend.example.up.railway.app'),
    'the backend websocket origin (lib/api.ts wsUrl())',
  );
  // THE PIN THIS FILE WAS WRITTEN FOR. The browser streams visit audio
  // straight to Soniox on the stt-rt path (lib/stt-stream.ts; ws_url is
  // server-authored). Omitting this origin does not fail the build, the type
  // check, or any socket-faking test — it fails LIVE, in a clinic, on every
  // visit, as an instant degrade to the async path. If this assertion is in
  // your way, you are about to re-ship that outage.
  assert.ok(
    entries.includes(SONIOX_RT_CONNECT_ORIGIN),
    'the Soniox EU realtime origin — removing it silently kills live transcription in prod',
  );
});

test('the Soniox origin is the single exact EU host, wss scheme, no wildcard', () => {
  assert.strictEqual(SONIOX_RT_CONNECT_ORIGIN, 'wss://stt-rt.eu.soniox.com');
  // The backend's server-authored ws_url (tubermed-backend/lib/soniox-stream.js
  // SONIOX_RT_WS_URL) must sit inside this origin — path is irrelevant to CSP,
  // origin is everything.
  assert.strictEqual(
    new URL('wss://stt-rt.eu.soniox.com/transcribe-websocket').origin,
    SONIOX_RT_CONNECT_ORIGIN,
  );
});

test('EU-only invariant: no origin outside the approved EU set may appear', () => {
  process.env.NEXT_PUBLIC_BACKEND_URL = PROD_LIKE_BACKEND;
  const backend = backendConnectOrigins();
  for (const entry of connectSrcEntries(contentSecurityPolicy())) {
    const allowed =
      entry === "'self'" ||
      backend.includes(entry) ||
      entry === SONIOX_RT_CONNECT_ORIGIN ||
      /^https:\/\/[a-z0-9]+\.ingest\.de\.sentry\.io$/.test(entry); // EU Sentry ingest only
    assert.ok(allowed, `unexpected connect-src origin: ${entry}`);
  }
});

test('no backend env → connect-src still degrades safely (self + Soniox only)', () => {
  delete process.env.NEXT_PUBLIC_BACKEND_URL;
  const entries = connectSrcEntries(contentSecurityPolicy());
  assert.deepStrictEqual(
    entries.filter((e) => e !== "'self'" && e !== SONIOX_RT_CONNECT_ORIGIN),
    [],
    'a missing backend URL must not admit any extra origin',
  );
});
