// AuthBrandPanel — the shared dark-navy left panel on /app/login and /signup.
// Both pages render it identically; edit here, never fork per-page copies.
//
// Lockup approach follows components/landing/brand.tsx: the font-independent
// monogram TILE is inlined as SVG and the wordmark is LIVE text — the lockup
// SVGs in /public/brand draw their wordmark with <text> in Inter Tight, which
// falls back to a generic font when loaded via <img>. AuthTileMark is a
// deliberate workspace-local COPY of the landing TileMark (auth must not
// import landing code; the workspace has no Inter Tight, so the wordmark uses
// --font-ui). Gradient id renamed lpTileGrad → authTileGrad so both tiles can
// coexist in one document. If the mark changes, update both copies.
//
// The gradient + waveform echo the onboarding wizard's WelcomeBand
// (components/OnboardingWizard.tsx) — same visual family, more restrained.
// Pure local/inline assets, zero third-party origins (EU invariant). Static —
// no animation, nothing to gate on prefers-reduced-motion.

// Static bar heights — the same calm abstract "voice" waveform as the wizard
// welcome band. Tallest bars sit mid-panel; the short left-edge bars keep the
// GDPR line's backdrop clean.
const WAVE_BARS = [10, 18, 26, 38, 30, 46, 34, 52, 40, 28, 44, 32, 22, 36, 26, 16, 24, 14, 20, 12];

export function AuthTileMark({ size = 44 }: { size?: number }) {
  // Rounded-square gradient tile + white "T" + light-accent node (Direction 02).
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="authTileGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2E5A8F" />
          <stop offset="1" stopColor="#1D3B5C" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="48" height="48" rx="13" fill="url(#authTileGrad)" />
      <g transform="translate(4 4)">
        <g stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round">
          <path d="M12 16 H36" />
          <path d="M24 16 V36" />
        </g>
        <path d="M12 26 H22" stroke="#8FC0E8" strokeWidth="6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function ShieldGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M8 1.5 13 3.5 V7.5 C13 10.6 10.9 13.1 8 14.5 C5.1 13.1 3 10.6 3 7.5 V3.5 Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M5.8 7.9 7.3 9.4 10.2 6.3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AuthBrandPanel() {
  return (
    <aside
      className="relative overflow-hidden hidden md:flex flex-col items-stretch justify-between px-10 py-12"
      style={{
        // Quiet navy gradient anchored on the workspace nav palette
        // (--color-nav-bg #1C2B44), shading toward the wizard band's family
        // navies — restrained, not the landing hero.
        background:
          "linear-gradient(170deg, var(--brand-panel-deep) 0%, var(--brand-panel-base) 48%, var(--brand-panel-mid) 100%)",
        color: "var(--color-nav-text)",
        width: "clamp(420px, 42vw, 560px)",
        flexShrink: 0,
      }}
    >
      {/* Waveform motif along the bottom edge — decorative, behind content. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 400 60"
        preserveAspectRatio="none"
        style={{
          position: "absolute",
          insetInline: 0,
          bottom: 0,
          width: "100%",
          height: 60,
          pointerEvents: "none",
        }}
      >
        {WAVE_BARS.map((h, i) => (
          <rect
            key={i}
            x={i * 20 + 6}
            y={60 - h}
            width={8}
            rx={4}
            height={h}
            fill="rgba(143, 192, 232, 0.16)"
          />
        ))}
      </svg>

      <div />

      <div className="relative flex flex-col items-start gap-5">
        <span className="inline-flex items-center gap-3">
          <AuthTileMark size={44} />
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
        <p
          className="leading-snug"
          style={{ color: "var(--color-nav-text)", fontSize: 15, maxWidth: 340 }}
        >
          Амбулаторни листове, генерирани от консултацията.
        </p>
      </div>

      <p
        className="relative inline-flex items-center gap-2"
        style={{ color: "var(--color-nav-text)", fontSize: 12 }}
      >
        <ShieldGlyph />
        <span>GDPR-съвместим · Данните се обработват в EU</span>
      </p>
    </aside>
  );
}
