// AuthBootSplash — the immediate branded loading state shown on /app/login and
// /signup while the session probe (api.me) is in flight, replacing the former
// blank-white gate so first paint is never a broken-looking white screen.
//
// Composed entirely from existing auth-brand pieces (no new visual system):
// AuthTileMark + the "TuberMed" wordmark lockup and the sanctioned navy panel
// gradient (--brand-panel-*), both from AuthBrandPanel. The spinner reuses the
// app's CSS border-spinner technique, themed light-on-navy; its rotation is
// hard-stopped under prefers-reduced-motion via .auth-boot-spinner in globals.css
// (matching the .proc-track / .record-ring / .nv-skeleton convention).
//
// Pure local/inline assets, zero third-party origins (EU invariant). No 'use
// client' needed — it is static markup imported into the client login/signup
// pages, exactly like AuthBrandPanel.

import { AuthTileMark } from "@/components/AuthBrandPanel";

export default function AuthBootSplash() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Зареждане…"
      className="min-h-screen flex flex-col items-center justify-center gap-7 px-6"
      style={{
        // Same navy gradient as AuthBrandPanel — allowed on auth/brand panels.
        background:
          "linear-gradient(170deg, var(--brand-panel-deep) 0%, var(--brand-panel-base) 48%, var(--brand-panel-mid) 100%)",
        color: "var(--color-nav-text)",
      }}
    >
      <span className="inline-flex items-center gap-3">
        <AuthTileMark size={48} />
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 700,
            fontSize: 30,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
          }}
        >
          <span style={{ color: "var(--color-nav-text-active)" }}>Tuber</span>
          <span style={{ color: "#8FC0E8" }}>Med</span>
        </span>
      </span>

      <span className="auth-boot-spinner" aria-hidden />

      <span style={{ color: "var(--color-nav-text)", fontSize: 13 }}>Зареждане…</span>
    </div>
  );
}
