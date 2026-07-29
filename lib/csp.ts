// ─────────────────────────────────────────────────────────────────────────────
// Content-Security-Policy builder — the policy string next.config.ts ships.
// ─────────────────────────────────────────────────────────────────────────────
// Extracted from next.config.ts (2026-07-29) so `npm test` can pin the
// connect-src contract. The reason this file exists is a failure mode that is
// INVISIBLE everywhere except a live production browser: the streaming leg
// (lib/stt-stream.ts) opens a websocket the Node tests fake and next dev never
// polices (the CSP is prod-only), so a connect-src that omits an origin the
// app really dials passes every offline gate and then kills the socket at
// open() on every prod visit. That exact miss shipped with stt-rt-v5: the
// Soniox origin below was absent, the browser refused the websocket, and every
// streamed visit degraded to the async path within seconds.
// scripts/csp.test.ts now pins each required origin so a future tightening
// cannot silently re-break one.
//
// Kept as a small PURE module (no Next imports) so node --test can import it
// directly — same pattern as lib/sentry-csp.ts.

import { sentryConnectOrigins } from "./sentry-csp";

// connect-src origins, derived from the SAME value the app fetches / opens its
// WebSocket with (lib/api.ts: BACKEND = NEXT_PUBLIC_BACKEND_URL; wsUrl() swaps
// https->wss / http->ws). EU-ONLY INVARIANT: cross-origin destinations are the
// EU backend, EU Sentry ingest, and the EU Soniox realtime endpoint — never a
// US / Google origin. NEXT_PUBLIC_* is build-time inlined, so this self-adjusts
// per environment (localhost in dev, the Railway EU origin on Vercel prod;
// preview deployments inherit the same env value). Derived, never hardcoded,
// so it can't drift from the real fetch origin.
export function backendConnectOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!raw) return [];
  try {
    const httpOrigin = new URL(raw).origin; // strips any path → scheme://host[:port]
    const wsOrigin = httpOrigin
      .replace(/^https:\/\//, "wss://")
      .replace(/^http:\/\//, "ws://"); // mirrors lib/api.ts wsUrl()
    return [httpOrigin, wsOrigin];
  } catch {
    return [];
  }
}

// The ONE deliberate exception to "derived, never hardcoded": the streaming
// websocket's destination is SERVER-AUTHORED (StreamKeyResponse.ws_url — the
// browser never builds it), so there is no client env var to derive from.
// This is the committed frontend mirror of the backend constant
// `SONIOX_RT_WS_URL` in tubermed-backend/lib/soniox-stream.js — EU host only,
// a constant there by data-residency design ("never an env var"), so the same
// discipline applies here: single exact origin, no wildcard, wss scheme.
// A backend endpoint change and this mirror must land TOGETHER (same
// cross-repo discipline as ial-inns.json / the template mirrors).
export const SONIOX_RT_CONNECT_ORIGIN = "wss://stt-rt.eu.soniox.com";

export function contentSecurityPolicy(): string {
  // connect-src = same-origin + the EU backend (https + wss) + the EU Soniox
  // realtime origin (the browser streams visit audio straight to it on the
  // stt-rt path — see lib/stt-stream.ts) + (when configured) the EU Sentry
  // ingest origin. sentryConnectOrigins() (lib/sentry-csp.ts) is DSN-derived +
  // EU-GUARDED — it returns nothing unless NEXT_PUBLIC_SENTRY_DSN points at
  // *.ingest.de.sentry.io, so an unset or non-EU DSN adds NO origin. See
  // AGENTS.md "Content-Security-Policy" — EU-invariant note.
  const connectSrc = [
    "'self'",
    ...backendConnectOrigins(),
    SONIOX_RT_CONNECT_ORIGIN,
    ...sentryConnectOrigins(),
  ].join(" ");
  return [
    "default-src 'self'",
    // 'unsafe-inline': Next App Router streams hydration via inline <script> with
    // NO nonce, and lib/exporters.ts' PDF print window injects an inline
    // close-script (the about:blank window inherits this CSP). There are NO
    // external script origins (verified). Tightening to a nonce needs middleware
    // wiring — deferred (AGENTS.md "Content-Security-Policy").
    "script-src 'self' 'unsafe-inline'",
    // Inline styles throughout: the hero's large inline style string, style=
    // attributes across components, and the export print/Word HTML.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'", // next/font self-hosts the woff2 at build time — no runtime Google Fonts
    `connect-src ${connectSrc}`, // same-origin + EU backend (https + wss) + EU Soniox realtime + EU Sentry ingest (when set)
    "media-src 'self' blob:", // MediaRecorder audio capture
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}
