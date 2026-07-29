import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { contentSecurityPolicy } from "./lib/csp";

// ── Canonical app domain (2026-06-11) ────────────────────────────────────────
// The Vercel project answers on www.tubermed.com / tubermed.com AND
// app.tubermed.com, but the backend CORS allowlist trusts ONLY
// https://app.tubermed.com — so app/auth pages RENDER on www while every API
// fetch dies in preflight (observed live: doctor lands on www, clicks Вход,
// product looks broken). Sessions are per-origin too, so serving the app on
// two origins would split logins. Decision: marketing stays on www/apex;
// every app/auth route 308s to the one canonical app origin.
//
// The host matcher guarantees these never fire on app.tubermed.com itself,
// and the landing (/, /privacy) stays un-redirected on www/apex.
//
// ⚠ When adding a NEW app/auth route OUTSIDE /app/* (like /signup), add its
// path to APP_PATHS — see "Canonical app domain" in AGENTS.md.
const APP_ORIGIN = "https://app.tubermed.com";
const MARKETING_HOSTS = ["www.tubermed.com", "tubermed.com"];
const APP_PATHS = ["/signup", "/app/:path*"];

// ── Baseline Content-Security-Policy + companion security headers (2026-06-23) ─
// Production-only (next dev's HMR uses ws:/eval that a strict CSP would flag).
// Shipped FIRST in Report-Only so violations are reported, never blocked; flip
// CSP_REPORT_ONLY=false to enforce once a deploy shows zero violations across the
// scribe flow. See AGENTS.md "Content-Security-Policy" for the policy + deferred
// tightenings (script-src/style-src nonce via middleware; the phone /mobile-page
// is served by the BACKEND and needs its own CSP there — not covered here).
// The policy itself lives in lib/csp.ts (pure module) so `npm test` can pin the
// connect-src contract — see scripts/csp.test.ts.
const CSP_REPORT_ONLY = false; // ENFORCING. Set true to drop back to Report-Only.

const securityHeaders = [
  {
    key: CSP_REPORT_ONLY
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy",
    value: contentSecurityPolicy(),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Belt-and-suspenders with frame-ancestors 'none' for legacy UAs.
  { key: "X-Frame-Options", value: "DENY" },
  // microphone=(self) is MANDATORY — the scribe records audio. camera/geo off.
  {
    key: "Permissions-Policy",
    value: "microphone=(self), camera=(), geolocation=()",
  },
  // HSTS: 2 years + preload. If Vercel is ever configured to also send HSTS,
  // remove one to avoid a duplicate header (see AGENTS.md).
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  async redirects() {
    // One entry per host × path — Next host matchers take a single value
    // (exact or regex-like), not alternation; separate entries are the
    // documented pattern (node_modules/next/dist/docs/.../redirects.md).
    return MARKETING_HOSTS.flatMap((host) =>
      APP_PATHS.map((source) => ({
        source,
        destination: `${APP_ORIGIN}${source}`,
        permanent: true, // 308 — method-preserving permanent redirect
        has: [{ type: "host" as const, value: host }],
      }))
    );
  },
  async headers() {
    // Gate to production: next dev's HMR (websocket + eval) would trip a strict
    // policy and flood the console. Applies under `next start` and on Vercel
    // (NODE_ENV=production). Verify a prod build locally: next build && next start.
    if (process.env.NODE_ENV !== "production") return [];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Sentry (browser + server + edge) — EU region, Replay OFF, tracing OFF, PII-scrubbed
// (instrumentation-client.ts + sentry.{server,edge}.config.ts + instrumentation.ts). withSentryConfig
// wraps the config and PRESERVES redirects() / headers() / the CSP unchanged. Source-map upload is
// DISABLED this pass, so the production build NEVER requires SENTRY_AUTH_TOKEN; telemetry off; silent
// build. No tunnelRoute (no Sentry tunnel this pass). Readable stack traces are a deferred follow-up.
export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  sourcemaps: { disable: true },
});
