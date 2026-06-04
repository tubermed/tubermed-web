'use client';

import { motion, useScroll, useSpring } from 'framer-motion';

// Thin top scroll-progress bar. Reflects scroll position (an affordance, not
// decorative motion), spring-smoothed. Sits above the sticky header.
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 });
  return (
    <motion.div
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-[60] h-[3px] origin-left"
      style={{ scaleX, background: 'linear-gradient(90deg, var(--lp-navy), var(--lp-accent))' }}
    />
  );
}
