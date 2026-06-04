'use client';

import { useEffect, useRef } from 'react';

// Always-on ambient motion: large blurred navy/accent orbs drifting on long
// loops (GPU transforms only). Sits behind content (z-0). Guardrails:
//  - paused when scrolled off-screen (IntersectionObserver) and when the tab
//    is hidden (visibilitychange) → no CPU/GPU burn in the background.
//  - prefers-reduced-motion disables the drift entirely (CSS @media).
export function AmbientOrbs({ subtle = false, className = '' }: { subtle?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let onScreen = true;
    const apply = () => {
      el.dataset.paused = !onScreen || document.hidden ? 'true' : 'false';
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        apply();
      },
      { threshold: 0 },
    );
    io.observe(el);
    const onVisibility = () => apply();
    document.addEventListener('visibilitychange', onVisibility);
    apply();
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div ref={ref} className={`lp-orbs ${subtle ? 'lp-orbs--subtle' : ''} ${className}`} aria-hidden="true">
      <span className="lp-orb lp-orb--1" />
      <span className="lp-orb lp-orb--2" />
      <span className="lp-orb lp-orb--3" />
    </div>
  );
}
