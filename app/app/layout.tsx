// Server pass-through layout whose ONLY job is the segment config below.
//
// Never CDN-cache the auth-gated /app/* shells: a corrupted Vercel edge-cache
// object made /app/scribe/result unloadable at the browser level twice in 48h
// (2026-07-28/29) with the code provably clean. force-dynamic serves the shell
// per-request (x-vercel-cache: MISS) — the only cache opt-out Vercel honours:
// headers() Cache-Control on prerendered output is overridden by the platform,
// and segment config in the 'use client' pages themselves is silently IGNORED
// (config is only read from server files — that near-miss is why this layout
// exists). Covers /app/login, /app/scribe, /app/scribe/result; the workspace
// group's twin is app/(workspace)/app/layout.tsx. Post-deploy check:
// node scripts/probe-shell-cache.mjs.
export const dynamic = 'force-dynamic';

import type { ReactNode } from 'react';

export default function AppSegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
