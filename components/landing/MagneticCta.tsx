'use client';

import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import type { ReactNode, MouseEvent } from 'react';

// Primary CTA with a subtle magnetic pull toward the cursor (desktop) + springy
// press. Reduced-motion → no magnetic pull, no tap-scale (static button).
const CLS =
  'lp-cta-primary inline-flex items-center justify-center gap-2 rounded-[var(--lp-radius)] px-7 py-3.5 text-base font-semibold transition-colors duration-200 outline-none';

export function MagneticCta({
  href,
  children,
  className = '',
  ariaLabel,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 300, damping: 20, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 300, damping: 20, mass: 0.4 });

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * 0.25);
    y.set((e.clientY - (r.top + r.height / 2)) * 0.35);
  };
  const reset = () => {
    x.set(0);
    y.set(0);
  };

  const cls = `${CLS} ${className}`;
  const isInternal = href.startsWith('/') && !href.startsWith('//');

  return (
    <motion.div
      className="inline-block"
      style={reduce ? undefined : { x: sx, y: sy }}
      onMouseMove={onMove}
      onMouseLeave={reset}
      whileTap={reduce ? undefined : { scale: 0.96 }}
    >
      {isInternal ? (
        <Link href={href} className={cls} aria-label={ariaLabel}>
          {children}
        </Link>
      ) : (
        <a href={href} className={cls} aria-label={ariaLabel}>
          {children}
        </a>
      )}
    </motion.div>
  );
}
