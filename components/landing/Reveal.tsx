'use client';

import { useEffect, useRef } from 'react';
import type { ElementType, CSSProperties, ReactNode } from 'react';

// Reveal-on-scroll wrapper. Adds `.lp-reveal` (hidden state, defined in
// globals.css) on the server-rendered element; on mount it observes itself and
// flips to `.is-visible` when it scrolls into view. Reduced-motion users get
// the content shown instantly (media query in globals.css), and a <noscript>
// override in the page keeps content visible when JS is off.
export function Reveal({
  children,
  as: Tag = 'div',
  className = '',
  delay = 0,
  style,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  /** stagger delay in ms */
  delay?: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-visible');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add('is-visible');
            io.unobserve(el);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`lp-reveal ${className}`}
      style={{ transitionDelay: delay ? `${delay}ms` : undefined, ...style }}
    >
      {children}
    </Tag>
  );
}
