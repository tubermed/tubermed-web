import Link from 'next/link';
import type { ReactNode } from 'react';

export function Container({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-6xl px-6 ${className}`}>{children}</div>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]"
      style={{ background: 'var(--lp-bg-tint)', color: 'var(--lp-navy)' }}
    >
      {children}
    </span>
  );
}

export function SectionHeading({
  title,
  intro,
  align = 'center',
  onDark = false,
}: {
  title: ReactNode;
  intro?: ReactNode;
  align?: 'center' | 'left';
  onDark?: boolean;
}) {
  const alignCls = align === 'center' ? 'text-center mx-auto' : 'text-left';
  return (
    <div className={`${alignCls} ${align === 'center' ? 'max-w-2xl' : ''}`}>
      <h2
        className="font-[family-name:var(--font-inter-tight)] text-3xl font-bold leading-[1.12] tracking-[-0.02em] md:text-[2.6rem]"
        style={{ color: onDark ? '#FFFFFF' : 'var(--lp-heading)' }}
      >
        {title}
      </h2>
      {intro ? (
        <p
          className="mt-4 text-base leading-relaxed md:text-lg"
          style={{ color: onDark ? 'var(--lp-on-navy-mut)' : 'var(--lp-text-muted)' }}
        >
          {intro}
        </p>
      ) : null}
    </div>
  );
}

type CtaVariant = 'primary' | 'secondary' | 'light';

const CTA_BASE =
  'inline-flex items-center justify-center gap-2 rounded-[var(--lp-radius)] px-7 py-3.5 text-base font-semibold transition-colors duration-200 outline-none';

function ctaClasses(variant: CtaVariant): string {
  switch (variant) {
    case 'secondary':
      return `${CTA_BASE} lp-cta-secondary`;
    case 'light':
      return `${CTA_BASE} lp-cta-light`;
    default:
      return `${CTA_BASE} lp-cta-primary`;
  }
}

export function Cta({
  href,
  children,
  variant = 'primary',
  className = '',
  ariaLabel,
}: {
  href: string;
  children: ReactNode;
  variant?: CtaVariant;
  className?: string;
  ariaLabel?: string;
}) {
  const cls = `${ctaClasses(variant)} ${className}`;
  // Internal routes use next/link (satisfies no-html-link-for-pages); anchors,
  // mailto and external links use <a>.
  const isInternal = href.startsWith('/') && !href.startsWith('//');
  if (isInternal) {
    return (
      <Link href={href} className={cls} aria-label={ariaLabel}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={cls} aria-label={ariaLabel}>
      {children}
    </a>
  );
}
