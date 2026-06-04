'use client';

import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import { useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';

// Subtle scroll parallax: translates its children on Y as the element scrolls
// through the viewport. Reduced-motion → no transform. Pass different from/to
// ranges to neighbouring layers so they move at slightly different speeds.
export function Parallax({
  children,
  from = 40,
  to = -40,
  className = '',
  style,
}: {
  children: ReactNode;
  from?: number;
  to?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [from, to]);
  return (
    <motion.div ref={ref} className={className} style={reduce ? style : { ...style, y }}>
      {children}
    </motion.div>
  );
}
