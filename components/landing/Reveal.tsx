'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { CSSProperties, ReactNode, ElementType } from 'react';

// Scroll-reveal wrapper (framer-motion whileInView, once). Staggering is done
// by passing increasing `delay` to sibling Reveals. Guardrails:
//  - prefers-reduced-motion → render the element instantly, no animation.
//  - no JS → the element carries data-reveal; a <noscript> rule in the landing
//    pages forces [data-reveal] visible (framer's inline opacity:0 has no
//    !important, so the noscript !important rule wins).
const EASE: [number, number, number, number] = [0.2, 0.7, 0.3, 1];

const TAGS = {
  div: motion.div,
  section: motion.section,
  article: motion.article,
  ul: motion.ul,
  ol: motion.ol,
  li: motion.li,
  span: motion.span,
} as const;

type RevealTag = keyof typeof TAGS;

export function Reveal({
  children,
  as = 'div',
  className = '',
  delay = 0,
  style,
}: {
  children: ReactNode;
  as?: RevealTag;
  className?: string;
  /** stagger delay in ms */
  delay?: number;
  style?: CSSProperties;
}) {
  const reduce = useReducedMotion();

  if (reduce) {
    const Tag = as as ElementType;
    return (
      <Tag className={className} style={style}>
        {children}
      </Tag>
    );
  }

  const M = TAGS[as] ?? motion.div;
  return (
    <M
      data-reveal=""
      className={className}
      style={style}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      transition={{ duration: 0.6, ease: EASE, delay: delay / 1000 }}
    >
      {children}
    </M>
  );
}
