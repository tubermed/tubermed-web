import type { NextConfig } from "next";

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
};

export default nextConfig;
