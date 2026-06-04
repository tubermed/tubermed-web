// TuberMed brand lockup for the landing.
//
// We render the font-independent monogram TILE inline as SVG + the wordmark as
// LIVE Inter Tight text (exact brand colours), rather than <img>-ing the lockup
// SVG — whose wordmark is <text> in Inter Tight and would fall back to a generic
// font when loaded via <img> (img-SVGs don't get the page's web fonts).
// This reproduces tubermed-monogram-lockup.svg faithfully and reskinnably.

type LogoVariant = 'light' | 'dark';

export function TileMark({ size = 36 }: { size?: number }) {
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
        <linearGradient id="lpTileGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2E5A8F" />
          <stop offset="1" stopColor="#1D3B5C" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="48" height="48" rx="13" fill="url(#lpTileGrad)" />
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

export function Logo({
  variant = 'light',
  size = 34,
  className = '',
}: {
  variant?: LogoVariant;
  size?: number;
  className?: string;
}) {
  const tuber = variant === 'dark' ? '#FFFFFF' : 'var(--lp-ink)';
  const med = variant === 'dark' ? 'var(--lp-accent-light)' : 'var(--lp-navy)';
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <TileMark size={size} />
      <span
        className="font-[family-name:var(--font-inter-tight)] font-bold leading-none"
        style={{ fontSize: '1.4rem', letterSpacing: '-0.045em' }}
      >
        <span style={{ color: tuber }}>Tuber</span>
        <span style={{ color: med }}>Med</span>
      </span>
    </span>
  );
}
